import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  detectVcsKind,
  findExecutable,
  mutationCommands,
  parseGitStatus,
  parseJjDiffSummary,
  parseJjFiles,
  parseJjLog,
  resolveVcsTool,
  summarizeJj,
} from "../../src/util/vcs"

const directories: string[] = []

function directory() {
  const value = mkdtempSync(path.join(tmpdir(), "opencode-vcs-"))
  directories.push(value)
  return value
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe("parseJjLog", () => {
  test("reads the change, bookmarks, description, and conflict state", () => {
    expect(parseJjLog("znnstyupywvs\tmain feature\tfix tabs\tfalse\ttrue\n")).toEqual({
      change: "znnstyupywvs",
      bookmarks: "main feature",
      description: "fix tabs",
      empty: false,
      conflict: true,
    })
  })

  test("keeps tabs inside a description", () => {
    expect(parseJjLog("znnstyupywvs\tmain\tfix\ttabs\tfalse\tfalse")).toMatchObject({
      description: "fix\ttabs",
      conflict: false,
    })
  })

  test("keeps an empty bookmark list empty", () => {
    expect(parseJjLog("znnstyupywvs\t\t\tfalse\tfalse")).toMatchObject({
      change: "znnstyupywvs",
      bookmarks: "",
      description: "",
      empty: false,
      conflict: false,
    })
  })
})

describe("parseJjDiffSummary", () => {
  test("counts changed files and ignores blank lines", () => {
    expect(parseJjDiffSummary("M src/app.tsx\nA src/vcs.ts\n\nD old.txt\n")).toBe(3)
    expect(parseJjDiffSummary("\n\n")).toBe(0)
  })
})

describe("parseGitStatus", () => {
  test("separates staged, unstaged, untracked, and renamed files", () => {
    const status =
      " M src/a.ts\0?? new.txt\0A  added.ts\0MM both.ts\0R  new-name.ts\0old-name.ts\0"
    expect(parseGitStatus(status)).toEqual([
      { file: "src/a.ts", status: "modified", staged: false, unstaged: true, conflict: false },
      { file: "new.txt", status: "added", staged: false, unstaged: true, conflict: false },
      { file: "added.ts", status: "added", staged: true, unstaged: false, conflict: false },
      { file: "both.ts", status: "modified", staged: true, unstaged: true, conflict: false },
      { file: "new-name.ts", status: "modified", staged: true, unstaged: false, conflict: false },
    ])
  })

  test("marks unmerged entries as conflicts", () => {
    expect(parseGitStatus("UU conflict.ts\0")).toEqual([
      { file: "conflict.ts", status: "modified", staged: true, unstaged: true, conflict: true },
    ])
  })
})

describe("parseJjFiles", () => {
  test("maps summary codes to file statuses", () => {
    expect(parseJjFiles("M src/a.ts\nA src/new.ts\nD old.ts\n")).toEqual([
      { file: "src/a.ts", status: "modified", staged: false, unstaged: true },
      { file: "src/new.ts", status: "added", staged: false, unstaged: true },
      { file: "old.ts", status: "deleted", staged: false, unstaged: true },
    ])
  })

  test("uses the destination path of a rename", () => {
    expect(parseJjFiles("R {old.txt => new.txt}\n")).toEqual([
      { file: "new.txt", status: "modified", staged: false, unstaged: true },
    ])
  })
})

describe("summarizeJj", () => {
  test("uses the bookmark, description, and changed file count", () => {
    expect(summarizeJj("znnstyupywvs\tmain\tfix tabs\tfalse\tfalse\n", "M src/app.tsx\nA src/vcs.ts\n")).toEqual({
      kind: "jj",
      label: "main",
      detail: "fix tabs",
      change: "znnstyupywvs",
      description: "fix tabs",
      dirty: 2,
      conflict: false,
      files: [
        { file: "src/app.tsx", status: "modified", staged: false, unstaged: true },
        { file: "src/vcs.ts", status: "added", staged: false, unstaged: true },
      ],
    })
  })

  test("falls back to the change id and a clean detail", () => {
    expect(summarizeJj("znnstyupywvs\t\t\tfalse\tfalse\n", "")).toMatchObject({
      label: "znnstyupywvs",
      detail: "clean",
      dirty: 0,
    })
  })

  test("surfaces a conflict", () => {
    expect(summarizeJj("znnstyupywvs\t\t\tfalse\ttrue\n", "")).toMatchObject({ conflict: true })
  })
})

describe("mutationCommands", () => {
  test("builds jj actions", () => {
    expect(mutationCommands("jj", "describe", "  fix tabs  ")).toEqual([
      { command: "jj", args: ["describe", "-m", "fix tabs"] },
    ])
    expect(mutationCommands("jj", "bookmark", "feature")).toEqual([
      { command: "jj", args: ["bookmark", "set", "feature", "-r", "@"] },
    ])
    expect(mutationCommands("jj", "new")).toEqual([{ command: "jj", args: ["new"] }])
    expect(mutationCommands("jj", "squash")).toEqual([
      { command: "jj", args: ["squash", "--use-destination-message"] },
    ])
    expect(mutationCommands("jj", "fetch")).toEqual([{ command: "jj", args: ["git", "fetch"] }])
    expect(mutationCommands("jj", "split", "split msg", ["a.ts", "b.ts"])).toEqual([
      { command: "jj", args: ["split", "-m", "split msg", "--", "a.ts", "b.ts"] },
    ])
    expect(mutationCommands("jj", "edit", "@-")).toEqual([{ command: "jj", args: ["edit", "@-"] }])
  })

  test("builds git stage and unstage commands", () => {
    expect(mutationCommands("git", "stage", undefined, ["a.ts", "b.ts"])).toEqual([
      { command: "git", args: ["add", "--", "a.ts", "b.ts"] },
    ])
    expect(mutationCommands("git", "unstage", undefined, ["a.ts"])).toEqual([
      { command: "git", args: ["restore", "--staged", "--", "a.ts"] },
    ])
  })

  test("commits staged files or stages everything first", () => {
    expect(mutationCommands("git", "commit", "message")).toEqual([
      { command: "git", args: ["commit", "-m", "message"] },
    ])
    expect(mutationCommands("git", "commit_all", "message")).toEqual([
      { command: "git", args: ["add", "-A"] },
      { command: "git", args: ["commit", "-m", "message"] },
    ])
  })

  test("requires input for describe, bookmark, and commit", () => {
    expect(mutationCommands("jj", "describe", "  ")).toEqual([])
    expect(mutationCommands("jj", "bookmark")).toEqual([])
    expect(mutationCommands("git", "commit")).toEqual([])
    expect(mutationCommands("git", "commit_all")).toEqual([])
    expect(mutationCommands("jj", "split", "message")).toEqual([])
    expect(mutationCommands("git", "stage")).toEqual([])
    expect(mutationCommands("git", "unstage", undefined, [])).toEqual([])
  })

  test("ignores actions that do not belong to the repository kind", () => {
    expect(mutationCommands("hg", "fetch")).toEqual([])
    expect(mutationCommands("git", "describe", "message")).toEqual([])
    expect(mutationCommands("jj", "commit", "message")).toEqual([])
  })
})

describe("detectVcsKind", () => {
  test("prefers a jj repository over its colocated git directory", () => {
    const root = directory()
    mkdirSync(path.join(root, ".jj"))
    mkdirSync(path.join(root, ".git"))
    expect(detectVcsKind(root)).toBe("jj")
  })

  test("detects git, hg, and a plain directory", () => {
    const git = directory()
    mkdirSync(path.join(git, ".git"))
    expect(detectVcsKind(git)).toBe("git")

    const hg = directory()
    mkdirSync(path.join(hg, ".hg"))
    expect(detectVcsKind(hg)).toBe("hg")

    expect(detectVcsKind(directory())).toBe("none")
  })
})

describe("resolveVcsTool", () => {
  function executable(root: string, name: string) {
    const file = path.join(root, name)
    writeFileSync(file, "")
    chmodSync(file, 0o755)
    return file
  }

  test("prefers lazyjj over jjui for jj repositories", () => {
    const root = directory()
    const lazyjj = executable(root, "lazyjj")
    executable(root, "jjui")
    expect(resolveVcsTool("jj", "auto", { PATH: root })).toEqual({
      id: "lazyjj",
      label: "lazyjj",
      command: lazyjj,
    })
  })

  test("uses jjui when lazyjj is unavailable", () => {
    const root = directory()
    const jjui = executable(root, "jjui")
    expect(resolveVcsTool("jj", "auto", { PATH: root })).toEqual({ id: "jjui", label: "jjui", command: jjui })
  })

  test("uses lazygit for git repositories", () => {
    const root = directory()
    const lazygit = executable(root, "lazygit")
    expect(resolveVcsTool("git", "auto", { PATH: root })).toEqual({
      id: "lazygit",
      label: "lazygit",
      command: lazygit,
    })
    expect(resolveVcsTool("hg", "auto", { PATH: root })).toBeUndefined()
  })

  test("honors an explicit preference and skips missing executables", () => {
    const root = directory()
    const lazygit = executable(root, "lazygit")
    expect(resolveVcsTool("jj", "lazygit", { PATH: root })).toEqual({
      id: "lazygit",
      label: "lazygit",
      command: lazygit,
    })
    expect(findExecutable("lazyjj", { PATH: root })).toBeUndefined()
  })
})
