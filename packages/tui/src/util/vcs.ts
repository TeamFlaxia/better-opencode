import { accessSync, constants, existsSync, statSync } from "node:fs"
import path from "node:path"

export type VcsKind = "jj" | "git" | "hg" | "none"
export type VcsToolID = "lazygit" | "lazyjj" | "jjui"
export type VcsToolPreference = "auto" | VcsToolID
export type VcsMutation =
  | "describe"
  | "new"
  | "squash"
  | "abandon"
  | "bookmark"
  | "fetch"
  | "push"
  | "commit"
  | "commit_all"
  | "pull"
  | "stage"
  | "unstage"
  | "split"
  | "split_parallel"
  | "edit"

export type VcsCommand = {
  readonly command: string
  readonly args: readonly string[]
}

export type VcsFile = {
  readonly file: string
  readonly status: "added" | "modified" | "deleted"
  readonly staged: boolean
  readonly unstaged: boolean
  readonly conflict?: boolean
}

export type VcsListEntry = {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly current?: boolean
  readonly remote?: boolean
  readonly immutable?: boolean
}

export type VcsBranchAction = "create" | "delete" | "rename"

export type VcsHunk = {
  readonly header: string
  readonly text: string
  readonly additions: number
  readonly deletions: number
}

export type VcsHunkPatch = {
  readonly header: string
  readonly hunks: readonly VcsHunk[]
}

export type VcsTool = {
  readonly id: VcsToolID
  readonly label: string
  readonly command: string
}

export type VcsSummary = {
  readonly kind: VcsKind
  readonly label: string
  readonly detail: string
  readonly change?: string
  readonly commit?: string
  readonly bookmarks?: string
  readonly description?: string
  readonly dirty: number
  readonly conflict: boolean
  readonly files: readonly VcsFile[]
}

const PREFERRED_TOOLS: Record<VcsKind, readonly VcsToolID[]> = {
  jj: ["lazyjj", "jjui"],
  git: ["lazygit"],
  hg: [],
  none: [],
}

export function detectVcsKind(canonical: string): VcsKind {
  // A colocated Git repository is part of jj's storage, not a second project to render.
  if (existsSync(path.join(canonical, ".jj"))) return "jj"
  if (existsSync(path.join(canonical, ".git"))) return "git"
  if (existsSync(path.join(canonical, ".hg"))) return "hg"
  return "none"
}

export function parseJjLog(output: string) {
  const line = output.trimEnd().split("\n").at(-1) ?? ""
  const parts = line.split("\t")
  // A description may contain tabs, so only the fixed leading and trailing fields are positional.
  const description = parts.slice(3, -2).join("\t")
  return {
    change: parts[0] ?? "",
    commit: parts[1] ?? "",
    bookmarks: parts[2] ?? "",
    description,
    empty: parts.at(-2) === "true",
    conflict: parts.at(-1) === "true",
  }
}

export function parseJjFiles(output: string): VcsFile[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const entry = line.slice(2).trim()
      if (!entry) return []
      const code = line[0]
      // Renames render as `R {old => new}`; the fileset commands take the new path.
      const file =
        code === "R" && entry.startsWith("{") && entry.endsWith("}")
          ? entry.slice(entry.indexOf("=>") + 2, -1).trim()
          : entry
      return [
        {
          file,
          status: code === "A" || code === "?" ? "added" : code === "D" ? "deleted" : "modified",
          staged: false,
          unstaged: true,
        } satisfies VcsFile,
      ]
    })
}

export function parseJjDiffSummary(output: string) {
  return parseJjFiles(output).length
}

export function parseGitStatus(output: string): VcsFile[] {
  const entries = output.split("\0")
  const files: VcsFile[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (!entry) continue
    const x = entry[0] ?? " "
    const y = entry[1] ?? " "
    const file = entry.slice(3)
    if (!file) continue
    // Rename and copy entries carry the original path in the next NUL field.
    if (x === "R" || x === "C") index++
    const code = x === " " || x === "?" ? y : x
    files.push({
      file,
      status: code === "A" || code === "?" ? "added" : code === "D" ? "deleted" : "modified",
      staged: x !== " " && x !== "?",
      unstaged: y !== " " || x === "?",
      conflict: x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D"),
    })
  }
  return files
}

export function parseGitBranches(output: string): VcsListEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [head, name, commit, ...subject] = line.split("\t")
      if (!name || name.startsWith("(")) return []
      return [
        {
          id: name,
          label: name,
          current: head.trim() === "*",
          detail: [commit, subject.join("\t")].filter(Boolean).join(" · "),
        },
      ]
    })
}

export function parseGitHistory(output: string): VcsListEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [id, date, author, ...subject] = line.split("\t")
      if (!id) return []
      return [
        {
          id,
          label: subject.join("\t") || "(no subject)",
          detail: [id, date, author].filter(Boolean).join(" · "),
        },
      ]
    })
}

export function parseJjBookmarks(output: string, currentChange?: string): VcsListEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [name, change, commit, ...rest] = line.split("\t")
      const immutable = rest.at(-1) === "true"
      const remote = rest.at(-2) ?? ""
      // The colocated Git repository appears as the internal `git` remote; it mirrors
      // the local bookmarks and would only duplicate them in the list.
      if (!name || remote === "git") return []
      const subject = rest.slice(0, -2).join("\t")
      return [
        {
          id: name,
          label: name,
          current: !remote && currentChange !== undefined && change === currentChange,
          detail: [commit, subject].filter(Boolean).join(" · "),
          ...(remote ? { remote: true } : {}),
          ...(immutable ? { immutable: true } : {}),
        },
      ]
    })
}

export function parseJjHistory(output: string): VcsListEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [change, commit, bookmarks, ...rest] = line.split("\t")
      if (!change) return []
      const immutable = rest.at(-1) === "true"
      return [
        {
          id: change,
          label: rest.slice(0, -1).join("\t") || "(no description)",
          detail: [change, commit, bookmarks].filter(Boolean).join(" · "),
          ...(immutable ? { immutable: true } : {}),
        },
      ]
    })
}

export function parseGitDiffHunks(patch: string): VcsHunkPatch {
  const starts = [...patch.matchAll(/^@@/gm)].map((match) => match.index)
  if (starts.length === 0) return { header: patch, hunks: [] }
  const header = patch.slice(0, starts[0])
  const hunks = starts.map((start, index) => {
    const text = patch.slice(start, starts[index + 1] ?? patch.length)
    const lines = text.split("\n")
    return {
      header: lines[0] ?? "",
      text,
      additions: lines.filter((line) => line.startsWith("+")).length,
      deletions: lines.filter((line) => line.startsWith("-")).length,
    } satisfies VcsHunk
  })
  return { header, hunks }
}

export function buildHunkPatch(patch: VcsHunkPatch, selected: readonly VcsHunk[]) {
  return patch.header + selected.map((hunk) => hunk.text).join("")
}

export function summarizeJj(log: string, diff: string): VcsSummary {
  const parsed = parseJjLog(log)
  const files = parseJjFiles(diff)
  const dirty = files.length
  return {
    kind: "jj",
    label: parsed.bookmarks || parsed.change || "working copy",
    detail: parsed.description || (dirty === 0 ? "clean" : `${dirty} changed file${dirty === 1 ? "" : "s"}`),
    dirty,
    conflict: parsed.conflict,
    files,
    ...(parsed.change ? { change: parsed.change } : {}),
    ...(parsed.commit ? { commit: parsed.commit } : {}),
    ...(parsed.bookmarks ? { bookmarks: parsed.bookmarks } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
  }
}

export function mutationCommands(
  kind: VcsKind,
  action: VcsMutation,
  input?: string,
  paths: readonly string[] = [],
): VcsCommand[] {
  const value = input?.trim()
  if (kind === "jj") {
    if (action === "describe") return value ? [{ command: "jj", args: ["describe", "-m", value] }] : []
    if (action === "new") return [{ command: "jj", args: ["new"] }]
    if (action === "squash") return [{ command: "jj", args: ["squash", "--use-destination-message"] }]
    if (action === "abandon") return [{ command: "jj", args: ["abandon", "@"] }]
    if (action === "bookmark") return value ? [{ command: "jj", args: ["bookmark", "set", value, "-r", "@"] }] : []
    if (action === "split")
      return value && paths.length ? [{ command: "jj", args: ["split", "-m", value, "--", ...paths] }] : []
    if (action === "split_parallel")
      return value && paths.length ? [{ command: "jj", args: ["split", "-p", "-m", value, "--", ...paths] }] : []
    if (action === "edit") return value ? [{ command: "jj", args: ["edit", value] }] : []
    if (action === "fetch") return [{ command: "jj", args: ["git", "fetch"] }]
    if (action === "push")
      return value ? [{ command: "jj", args: ["git", "push", "--bookmark", value] }] : [{ command: "jj", args: ["git", "push"] }]
    return []
  }
  if (kind === "git") {
    if (action === "commit") return value ? [{ command: "git", args: ["commit", "-m", value] }] : []
    if (action === "commit_all")
      return value
        ? [
            { command: "git", args: ["add", "-A"] },
            { command: "git", args: ["commit", "-m", value] },
          ]
        : []
    if (action === "stage") return paths.length ? [{ command: "git", args: ["add", "--", ...paths] }] : []
    if (action === "unstage")
      return paths.length ? [{ command: "git", args: ["restore", "--staged", "--", ...paths] }] : []
    if (action === "fetch") return [{ command: "git", args: ["fetch", "--all", "--prune"] }]
    if (action === "pull") return [{ command: "git", args: ["pull", "--ff-only"] }]
    if (action === "push") return [{ command: "git", args: ["push"] }]
    return []
  }
  return []
}

export function resolveVcsTool(
  kind: VcsKind,
  preference: VcsToolPreference,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): VcsTool | undefined {
  if (kind === "none") return
  const candidates = preference === "auto" ? PREFERRED_TOOLS[kind] : [preference]
  for (const id of candidates) {
    const command = findExecutable(id, environment)
    if (command) return { id, label: id, command }
  }
}

export function findExecutable(
  command: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const search = environment.PATH ?? environment.Path ?? ""
  const extensions = process.platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""]
  for (const directory of search.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const file = path.join(directory, command + extension)
      if (isExecutable(file)) return file
    }
  }
}

function isExecutable(file: string) {
  try {
    if (!statSync(file).isFile()) return false
    if (process.platform !== "win32") accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
