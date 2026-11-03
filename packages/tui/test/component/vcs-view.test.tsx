/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { VcsView, type VcsViewController } from "../../src/component/vcs-view"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import type { VcsBranchAction, VcsListEntry, VcsMutation, VcsSummary } from "../../src/util/vcs"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const jj: VcsSummary = {
  kind: "jj",
  label: "main",
  detail: "fix tabs",
  change: "znnsty",
  bookmarks: "main",
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
  summary: VcsSummary
  execute?: (action: VcsMutation, input?: string, paths?: readonly string[]) => void
  branches?: () => VcsListEntry[]
  history?: () => VcsListEntry[]
  show?: (ref: string) => string
  switchTo?: (ref: string) => void
  startChange?: (ref: string) => void
  branchAction?: (action: VcsBranchAction, input: Record<string, string | undefined>) => void
}): VcsViewController {
  return {
    summary: () => input.summary,
    tool: () => undefined,
    refresh: async () => {},
    openTool: async () => {},
    openCommand: async () => {},
    execute: async (action, value, paths) => input.execute?.(action, value, paths),
    patch: async (file) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
    branches: async () => input.branches?.() ?? [],
    history: async () => input.history?.() ?? [],
    show: async (ref) => input.show?.(ref) ?? `commit ${ref}`,
    switchTo: async (ref) => input.switchTo?.(ref),
    startChange: async (ref) => input.startChange?.(ref),
    branchAction: async (action, value) => input.branchAction?.(action, value),
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

test("shows the preferred repository and its files", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={controller({ summary: jj })} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("Status") &&
        frame.includes("jj") &&
        frame.includes("main") &&
        frame.includes("Files · 1") &&
        frame.includes("src/a.ts"),
    )
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("src/b.ts")
    expect(frame).toContain("Bookmarks")
    expect(frame).toContain("Changes")
  } finally {
    app.renderer.destroy()
  }
})

test("cycles panels with tab and the arrow keys", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({ summary: jj, branches: () => jjBranches, history: () => jjHistory })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("d describe") && frame.includes("enter diff"))
    app.mockInput.pressTab()
    await app.waitForFrame((frame) => frame.includes("n create") && frame.includes("enter edit"))
    app.mockInput.pressArrow("right")
    await app.waitForFrame((frame) => frame.includes("n bookmark at change"))
    app.mockInput.pressArrow("left")
    await app.waitForFrame((frame) => frame.includes("n create") && frame.includes("enter edit"))
    app.mockInput.pressKey("1")
    await app.waitForFrame((frame) => frame.includes("Repository"))
    app.mockInput.pressKey("2")
    await app.waitForFrame((frame) => frame.includes("Diff") && frame.includes("enter diff"))
  } finally {
    app.renderer.destroy()
  }
})

test("space unstages the selected staged git file", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: git,
            execute: (action, value, paths) => executed.push([action, value, paths]),
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
    app.mockInput.pressKey(" ")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["unstage", undefined, ["src/b.ts"]])
  } finally {
    app.renderer.destroy()
  }
})

test("scrolls only when the selection leaves the viewport", async () => {
  const files = Array.from({ length: 8 }, (_, index) => ({
    file: `src/f${index}.ts`,
    status: "modified" as const,
    staged: false,
    unstaged: true,
  }))
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={controller({ summary: { ...jj, dirty: files.length, files } })} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/f0.ts"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("src/f0.ts") && frame.includes("src/f1.ts"))
    for (let index = 0; index < 7; index++) app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("src/f7.ts"))
  } finally {
    app.renderer.destroy()
  }
})

const jjBranches: VcsListEntry[] = [
  { id: "main", label: "main", detail: "mntrunsmtoom · current", current: true },
  { id: "feature-jj", label: "feature-jj", detail: "qywvssxltvqq · work in progress" },
]
const jjHistory: VcsListEntry[] = [
  { id: "qywvssxltvqq", label: "working copy", detail: "qywvssxltvqq · 62730de940ae" },
  { id: "mntrunsmtoom", label: "feat: previous change", detail: "mntrunsmtoom · 2c35b8929271 · main" },
]

test("lists bookmarks and edits the selected bookmark", async () => {
  const switched: string[] = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => jjBranches,
            switchTo: (ref) => switched.push(ref),
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
      (frame) => frame.includes("feature-jj") && frame.includes("Bookmarks · 2") && frame.includes("@ main"),
    )

    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 1)
    expect(switched[0]).toBe("feature-jj")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the selected row while the summary refreshes", async () => {
  const switched: string[] = []
  const [summary, setSummary] = createSignal<VcsSummary>(jj)
  const base = controller({
    summary: jj,
    branches: () => jjBranches,
    switchTo: (ref) => switched.push(ref),
  })
  let loads = 0
  const reactive: VcsViewController = {
    ...base,
    summary,
    branches: async () => {
      loads++
      return jjBranches
    },
  }
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={reactive} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
    app.mockInput.pressKey("3")
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("enter edit"))
    setSummary({ ...jj, commit: "62730de940ae" })
    await app.waitFor(() => loads >= 2)
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 1)
    expect(switched).toEqual(["feature-jj"])
  } finally {
    app.renderer.destroy()
  }
})

test("pushes the selected jj bookmark", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => jjBranches,
            execute: (action, value, paths) => executed.push([action, value, paths]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
    app.mockInput.pressKey("3")
    app.mockInput.pressArrow("down")
    app.mockInput.pressKey("p")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["push", "feature-jj", undefined])
  } finally {
    app.renderer.destroy()
  }
})

test("chooses a jj bookmark to push when none is focused", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({ summary: jj, branches: () => jjBranches })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
    app.mockInput.pressKey("1")
    app.mockInput.pressKey("p")
    await app.waitForFrame(
      (frame) => frame.includes("Push bookmark") && frame.includes("main") && frame.includes("feature-jj"),
    )
  } finally {
    app.renderer.destroy()
  }
})

test("starts a new change from an immutable bookmark", async () => {
  const switched: string[] = []
  const started: string[] = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              { id: "main@origin", label: "main@origin", detail: "62730de940ae · main", remote: true, immutable: true },
            ],
            switchTo: (ref) => switched.push(ref),
            startChange: (ref) => started.push(ref),
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
    await app.waitForFrame((frame) => frame.includes("main@origin") && frame.includes("enter new"))
    app.mockInput.pressEnter()
    await app.waitFor(() => started.length === 1)
    expect(started).toEqual(["main@origin"])
    expect(switched).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("shows history and previews the selected change", async () => {
  const shown: string[] = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            history: () => jjHistory,
            show: (ref) => {
              shown.push(ref)
              return `change ${ref}\n+added`
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
    app.mockInput.pressKey("4")
    await app.waitForFrame(
      (frame) =>
        frame.includes("working copy") &&
        frame.includes("feat: previous chan") &&
        frame.includes("Changes · 2") &&
        frame.includes("+added"),
    )
    expect(shown.at(-1)).toBe("qywvssxltvqq")
  } finally {
    app.renderer.destroy()
  }
})

test("creates a bookmark at the selected history entry", async () => {
  const actions: Array<[VcsBranchAction, Record<string, string | undefined>]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            history: () => jjHistory,
            branchAction: (action, value) => actions.push([action, value]),
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
    app.mockInput.pressKey("4")
    await app.waitForFrame((frame) => frame.includes("working copy") && frame.includes("n bookmark at change"))
    app.mockInput.pressKey("n")
    await app.waitForFrame((frame) => frame.includes("Create bookmark"))
    app.mockInput.typeText("feature")
    app.mockInput.pressEnter()
    await app.waitFor(() => actions.length === 1)
    expect(actions[0]).toEqual(["create", { target: "qywvssxltvqq", name: "feature" }])
  } finally {
    app.renderer.destroy()
  }
})

test("hides git staging state in a jj repository", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={controller({ summary: jj })} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("unstaged")
    expect(frame).not.toContain("stage hunks")
    expect(frame).not.toContain("external")
  } finally {
    app.renderer.destroy()
  }
})

test("does not delete or rename a remote bookmark", async () => {
  const actions: Array<[VcsBranchAction, Record<string, string | undefined>]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [{ id: "main@origin", label: "main@origin", detail: "abc123", remote: true }],
            branchAction: (action, value) => actions.push([action, value]),
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
    await app.waitForFrame((frame) => frame.includes("main@origin") && frame.includes("enter edit"))
    app.mockInput.pressKey("x")
    app.mockInput.pressKey("m")
    await app.waitForFrame(
      (frame) => frame.includes("main@origin") && !frame.includes("Delete bookmark") && !frame.includes("Rename bookmark"),
    )
    expect(actions).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
