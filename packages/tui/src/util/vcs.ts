import { accessSync, constants, existsSync, statSync } from "node:fs"
import path from "node:path"

export type VcsKind = "jj" | "git" | "hg" | "none"
export type VcsToolID = "lazygit" | "lazyjj" | "jjui"
export type VcsToolPreference = "auto" | VcsToolID

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
  readonly dirty: number
  readonly conflict: boolean
}

const PREFERRED_TOOLS: Record<VcsKind, readonly VcsToolID[]> = {
  jj: ["lazyjj", "jjui"],
  git: ["lazygit"],
  hg: [],
  none: [],
}

export function detectVcsKind(canonical: string): VcsKind {
  if (existsSync(path.join(canonical, ".jj"))) return "jj"
  if (existsSync(path.join(canonical, ".git"))) return "git"
  return existsSync(path.join(canonical, ".hg")) ? "hg" : "none"
}

export function parseJjLog(output: string) {
  const line = output.trimEnd().split("\n").at(-1) ?? ""
  const parts = line.split("\t")
  // A description may contain tabs, so only the fixed leading and trailing fields are positional.
  const description = parts.slice(2, -2).join("\t")
  return {
    change: parts[0] ?? "",
    bookmarks: parts[1] ?? "",
    description,
    empty: parts.at(-2) === "true",
    conflict: parts.at(-1) === "true",
  }
}

export function parseJjDiffSummary(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length
}

export function summarizeJj(log: string, diff: string): VcsSummary {
  const parsed = parseJjLog(log)
  const dirty = parseJjDiffSummary(diff)
  return {
    kind: "jj",
    label: parsed.bookmarks || parsed.change || "working copy",
    detail: parsed.description || (dirty === 0 ? "clean" : `${dirty} changed file${dirty === 1 ? "" : "s"}`),
    dirty,
    conflict: parsed.conflict,
    ...(parsed.change ? { change: parsed.change } : {}),
  }
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
  const extensions =
    process.platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""]
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
