import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  detectVcsKind,
  findExecutable,
  mutationCommands,
  parseJjDiffSummary,
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
  })

  test("builds the two-step git commit", () => {
    expect(mutationCommands("git", "commit", "message")).toEqual([
      { command: "git", args: ["add", "-A"] },
      { command: "git", args: ["commit", "-m", "message"] },
    ])
  })

  test("requires input for describe, bookmark, and commit", () => {
    expect(mutationCommands("jj", "describe", "  ")).toEqual([])
    expect(mutationCommands("jj", "bookmark")).toEqual([])
    expect(mutationCommands("git", "commit")).toEqual([])
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
