/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { VcsView, type VcsViewController } from "../../src/component/vcs-view"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import type { VcsBranchAction, VcsKind, VcsListEntry, VcsMutation, VcsSummary } from "../../src/util/vcs"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const jj: VcsSummary = {
  kind: "jj",
  label: "main",
  detail: "fix tabs",
  change: "znnsty",
  description: "fix tabs",
  dirty: 1,
  conflict: false,
  files: [{ file: "src/a.ts", status: "modified", staged: false, unstaged: true }],
}
const git: VcsSummary = {
  kind: "git",
  label: "main",
  detail: "1 changed file",
  dirty: 1,
  conflict: false,
  files: [{ file: "src/b.ts", status: "added", staged: true, unstaged: false }],
}

function controller(input: {
  summaries: readonly VcsSummary[]
  execute?: (action: VcsMutation, input?: string, paths?: readonly string[], kind?: VcsSummary["kind"]) => void
  branches?: (kind: VcsKind) => VcsListEntry[]
  history?: (kind: VcsKind) => VcsListEntry[]
  show?: (kind: VcsKind, ref: string) => string
  switchTo?: (kind: VcsKind, ref: string) => void
  branchAction?: (kind: VcsKind, action: VcsBranchAction, input: Record<string, string | undefined>) => void
}): VcsViewController {
  return {
    summaries: () => input.summaries,
    summary: () => input.summaries[0],
    refreshing: () => false,
    tool: () => undefined,
    refresh: async () => {},
    openTool: async () => {},
    openCommand: async () => {},
    execute: async (action, value, paths, kind) => input.execute?.(action, value, paths, kind),
    patch: async (kind, file) =>
      `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old ${kind}\n+new ${kind}\n`,
    branches: async (kind) => input.branches?.(kind) ?? [],
    history: async (kind) => input.history?.(kind) ?? [],
    show: async (kind, ref) => input.show?.(kind, ref) ?? `commit ${ref}`,
    switchTo: async (kind, ref) => input.switchTo?.(kind, ref),
    branchAction: async (kind, action, value) => input.branchAction?.(kind, action, value),
    hunks: async () => ({ header: "", hunks: [] }),
    applyHunks: async () => {},
  }
}

function Providers(props: ParentProps) {
  return (
    <TestTuiContexts>
      <ConfigProvider config={createTuiResolvedConfig()}>
        <TuiI18nProvider>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>{props.children}</DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </TuiI18nProvider>
      </ConfigProvider>
    </TestTuiContexts>
  )
}

test("shows jj and git together and switches the active repository", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={controller({ summaries: [jj, git] })} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("jj") && frame.includes("git") && frame.includes("src/a.ts") && frame.includes("src/b.ts"),
    )
    app.mockInput.pressArrow("right")
    await app.waitForFrame((frame) => frame.includes("git src/b.ts") && frame.includes("staged"))
  } finally {
    app.renderer.destroy()
  }
})

test("space unstages the selected staged git file", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summaries: [jj, git],
            execute: (action, value, paths, kind) => executed.push([action, value, paths, kind]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/b.ts"))
    app.mockInput.pressArrow("right")
    app.mockInput.pressKey(" ")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["unstage", undefined, ["src/b.ts"], "git"])
  } finally {
    app.renderer.destroy()
  }
})

const jjBranches: VcsListEntry[] = [
  { id: "main", label: "main", detail: "mntrunsmtoom · current", current: true },
  { id: "feature-jj", label: "feature-jj", detail: "qywvssxltvqq · work in progress" },
]
const gitBranches: VcsListEntry[] = [
  { id: "main", label: "main", detail: "62730de940ae · current", current: true },
  { id: "feature-git", label: "feature-git", detail: "2c35b8929271 · topic" },
]
const jjHistory: VcsListEntry[] = [
  { id: "qywvssxltvqq", label: "working copy", detail: "qywvssxltvqq · 62730de940ae" },
  { id: "mntrunsmtoom", label: "feat: previous change", detail: "mntrunsmtoom · 2c35b8929271 · main" },
]
const gitHistory: VcsListEntry[] = [
  { id: "62730de940", label: "wip", detail: "62730de940 · 2026-11-02 · Mikan256" },
  { id: "2c35b89292", label: "feat: previous change", detail: "2c35b89292 · 2026-11-02 · Mikan256" },
]

test("lists branches for both repositories and switches the selected branch", async () => {
  const switched: Array<[VcsKind, string]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summaries: [jj, git],
            branches: (kind) => (kind === "jj" ? jjBranches : gitBranches),
            switchTo: (kind, ref) => switched.push([kind, ref]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("2")
    await app.waitForFrame((frame) => frame.includes("feature-jj") && frame.includes("feature-git"))

    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 1)
    expect(switched[0]).toEqual(["jj", "feature-jj"])

    app.mockInput.pressArrow("right")
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("git feature-git"))
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 2)
    expect(switched[1]).toEqual(["git", "feature-git"])
  } finally {
    app.renderer.destroy()
  }
})

test("shows history and previews the selected commit", async () => {
  const shown: Array<[VcsKind, string]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summaries: [jj, git],
            history: (kind) => (kind === "jj" ? jjHistory : gitHistory),
            show: (kind, ref) => {
              shown.push([kind, ref])
              return `commit ${kind} ${ref}\n+added`
            },
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame(
      (frame) => frame.includes("working copy") && frame.includes("feat: previous chan") && frame.includes("+added"),
    )
    expect(shown.at(-1)).toEqual(["jj", "qywvssxltvqq"])
  } finally {
    app.renderer.destroy()
  }
})

test("creates a bookmark at the selected history entry", async () => {
  const actions: Array<[VcsKind, VcsBranchAction, Record<string, string | undefined>]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summaries: [jj],
            history: () => jjHistory,
            branchAction: (kind, action, value) => actions.push([kind, action, value]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("working copy"))
    app.mockInput.pressKey("n")
    await app.waitForFrame((frame) => frame.includes("Create bookmark"))
    app.mockInput.typeText("feature")
    app.mockInput.pressEnter()
    await app.waitFor(() => actions.length === 1)
    expect(actions[0]).toEqual(["jj", "create", { target: "qywvssxltvqq", name: "feature" }])
  } finally {
    app.renderer.destroy()
  }
})
