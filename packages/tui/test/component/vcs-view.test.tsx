/** @jsxImportSource @opentui/solid */
import { Renderable, ScrollBoxRenderable } from "@opentui/core"
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
const colocated: VcsSummary = { ...jj, git: true }
const gitBranchList: VcsListEntry[] = [
  { id: "main", label: "main", name: "main", current: true, detail: "62730de940ae · current" },
  {
    id: "origin/feature",
    label: "origin/feature",
    name: "feature",
    remote: true,
    remoteName: "origin",
    detail: "2c35b8929271 · topic",
  },
]
const gitHistoryList: VcsListEntry[] = [
  {
    id: "abc1234567",
    label: "Merge branch 'feature'",
    detail: "abc1234567 · 2026-11-02 · Mikan256 · merge",
    merge: true,
  },
  {
    id: "def1234567",
    label: "feat: previous",
    detail: "def1234567 · 2026-11-01 · Mikan256",
  },
]

function controller(input: {
  summary: VcsSummary
  execute?: (action: VcsMutation, input?: string, paths?: readonly string[], remote?: string) => void
  branches?: () => VcsListEntry[]
  gitBranches?: () => VcsListEntry[]
  remotes?: () => string[]
  history?: () => VcsListEntry[]
  gitHistory?: (ref?: string) => VcsListEntry[]
  show?: (ref: string) => string
  switchTo?: (ref: string, options?: { localName?: string }) => void
  gitSwitchTo?: (ref: string, options?: { localName?: string }) => void
  startChange?: (ref: string) => void
  moveBookmark?: (name: string, target: string) => void
  branchAction?: (action: VcsBranchAction, input: Record<string, string | undefined>) => void
  tags?: () => VcsListEntry[]
  pushTag?: (tag: string, remote?: string) => void
}): VcsViewController {
  return {
    summary: () => input.summary,
    tool: () => undefined,
    refresh: async () => {},
    openTool: async () => {},
    openCommand: async () => {},
    execute: async (action, value, paths, remote) => input.execute?.(action, value, paths, remote),
    patch: async (file) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+new\n`,
    branches: async () => input.branches?.() ?? [],
    ...(input.gitBranches ? { gitBranches: async () => input.gitBranches!() } : {}),
    remotes: async () => input.remotes?.() ?? [],
    history: async () => input.history?.() ?? [],
    ...(input.gitHistory ? { gitHistory: async (ref?: string) => input.gitHistory!(ref) } : {}),
    show: async (ref) => input.show?.(ref) ?? `commit ${ref}`,
    switchTo: async (ref, options) => input.switchTo?.(ref, options),
    ...(input.gitSwitchTo ? { gitSwitchTo: async (ref: string, options?: { localName?: string }) => input.gitSwitchTo!(ref, options) } : {}),
    startChange: async (ref) => input.startChange?.(ref),
    moveBookmark: async (name, target) => input.moveBookmark?.(name, target),
    branchAction: async (action, value) => input.branchAction?.(action, value),
    ...(input.tags ? { tags: async () => input.tags!() } : {}),
    ...(input.pushTag ? { pushTag: async (tag: string, remote?: string) => input.pushTag!(tag, remote) } : {}),
    hunks: async () => ({ header: "", hunks: [] }),
    applyHunks: async () => {},
  }
}

function findScrollBoxes(node: Renderable): ScrollBoxRenderable[] {
  return [
    ...(node instanceof ScrollBoxRenderable ? [node] : []),
    ...node.getChildren().flatMap(findScrollBoxes),
  ]
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
        frame.includes("znnsty") &&
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

test("shows Git branches and history beside jj changes in a colocated repository", async () => {
  const switched: Array<[string, { localName?: string } | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: colocated,
            branches: () => jjBranches,
            gitBranches: () => gitBranchList,
            gitHistory: () => gitHistoryList,
            gitSwitchTo: (ref, options) => switched.push([ref, options]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 28, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("src/a.ts") &&
        frame.includes("Branches · 2") &&
        frame.includes("origin/feature") &&
        frame.includes("g switch") &&
        !frame.includes("Bookmarks"),
    )
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("enter switch") && frame.includes("t push tag"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("origin/feature"))
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 1)
    expect(switched[0]).toEqual(["origin/feature", { localName: "feature" }])

    app.mockInput.pressKey("4")
    await app.waitForFrame(
      (frame) =>
        frame.includes("Commits · 2") &&
        frame.includes("Merge branch 'feature'") &&
        frame.includes("feat: previous") &&
        frame.includes("M"),
    )

    app.mockMouse.click(2, 0)
    await app.waitForFrame((frame) => frame.includes("Bookmarks · 2") && frame.includes("feature-jj"))
  } finally {
    app.renderer.destroy()
  }
})

test("pushes a tag from the Git refs view", async () => {
  const pushed: Array<[string, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: colocated,
            gitBranches: () => gitBranchList,
            remotes: () => ["origin"],
            tags: () => [{ id: "v2.2.5", label: "v2.2.5", name: "v2.2.5", detail: "abc · release", tag: true }],
            pushTag: (tag, remote) => pushed.push([tag, remote]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 28, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Branches · 2"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("t push tag"))
    app.mockInput.pressKey("t")
    await app.waitForFrame(
      (frame) => frame.includes("Push tag") && frame.includes("All tags") && frame.includes("v2.2.5"),
    )
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => pushed.length === 1)
    expect(pushed[0]).toEqual(["v2.2.5", "origin"])
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

test("does not draw a horizontal scrollbar under the panels", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: {
              ...jj,
              files: [
                {
                  file: "packages/tui/src/feature-plugins/system/storybook/some/deeply/nested/file.tsx",
                  status: "modified",
                  staged: false,
                  unstaged: true,
                },
              ],
            },
            branches: () => [
              {
                id: "main",
                label: "feature/a-really-long-branch-name-that-overflows-the-sidebar",
                detail: "62730de940ae · current",
                current: true,
              },
            ],
            history: () => [
              {
                id: "abc",
                label: "fix(tui): a really long commit subject that overflows the sidebar",
                detail: "abc · 62730de940ae",
              },
            ],
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Bookmarks · 1") && frame.includes("Changes · 1"))
    const scrolls = findScrollBoxes(app.renderer.root)
    expect(scrolls.length).toBeGreaterThan(0)
    for (const scroll of scrolls) {
      expect(scroll.horizontalScrollBar.visible).toBe(false)
      expect(scroll.verticalScrollBar.visible).toBe(true)
    }
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
    await app.waitForFrame((frame) => frame.includes("Bookmarks · 2") && frame.includes("@ main"))

    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
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
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("enter edit"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
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
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("enter edit"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("feature-jj"))
    app.mockInput.pressKey("p")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["push", "feature-jj", []])
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
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("Local · 2"))
    app.mockInput.pressKey("1")
    app.mockInput.pressKey("p")
    await app.waitForFrame(
      (frame) => frame.includes("Push bookmark") && frame.includes("main") && frame.includes("feature-jj"),
    )
  } finally {
    app.renderer.destroy()
  }
})

test("groups local and remote bookmarks and shows tracking state", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              { id: "main", label: "main", name: "main", current: true, detail: "62730de940ae · current" },
              {
                id: "main@origin",
                label: "main@origin",
                name: "main",
                remote: true,
                remoteName: "origin",
                tracked: true,
                detail: "62730de940ae · current",
              },
              {
                id: "topic@origin",
                label: "topic@origin",
                name: "topic",
                remote: true,
                remoteName: "origin",
                tracked: false,
                detail: "2c35b8929271 · topic",
              },
            ],
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 32, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("Local · 1") &&
        frame.includes("Remote · 2") &&
        frame.includes("main@origin") &&
        frame.includes("tracked") &&
        frame.includes("untracked"),
    )
  } finally {
    app.renderer.destroy()
  }
})

test("toggles tracking for a remote bookmark", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              {
                id: "main@origin",
                label: "main@origin",
                name: "main",
                remote: true,
                remoteName: "origin",
                tracked: false,
                detail: "62730de940ae · current",
              },
            ],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    await app.waitForFrame((frame) => frame.includes("t track"))
    app.mockInput.pressKey("t")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["track", "main@origin", undefined, undefined])
  } finally {
    app.renderer.destroy()
  }
})

test("moves the selected bookmark to a revset", async () => {
  const moves: Array<[string, string]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => jjBranches,
            moveBookmark: (name, target) => moves.push([name, target]),
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
    await app.waitForFrame((frame) => frame.includes("b move"))
    app.mockInput.pressKey("b")
    await app.waitForFrame((frame) => frame.includes("Move bookmark main"))
    app.mockInput.pressEnter()
    await app.waitFor(() => moves.length === 1)
    expect(moves[0]).toEqual(["main", "@"])
  } finally {
    app.renderer.destroy()
  }
})

test("moves a bookmark to the selected change", async () => {
  const moves: Array<[string, string]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => jjBranches,
            history: () => jjHistory,
            moveBookmark: (name, target) => moves.push([name, target]),
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
    await app.waitForFrame((frame) => frame.includes("b move bookmark here"))
    app.mockInput.pressKey("b")
    await app.waitForFrame(
      (frame) => frame.includes("Move bookmark to qywvssxltvqq") && frame.includes("feature-jj"),
    )
    app.mockInput.pressEnter()
    await app.waitFor(() => moves.length === 1)
    expect(moves[0]).toEqual(["main", "qywvssxltvqq"])
  } finally {
    app.renderer.destroy()
  }
})

test("chooses a remote to fetch from", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            remotes: () => ["origin", "upstream"],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    app.mockInput.pressKey("f")
    await app.waitForFrame((frame) => frame.includes("Fetch remote") && frame.includes("upstream"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Fetch from origin") && frame.includes("Tracked only"))
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["fetch", undefined, [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

test("fetches only tracked refs from a remote", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            remotes: () => ["origin", "upstream"],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    app.mockInput.pressKey("f")
    await app.waitForFrame((frame) => frame.includes("Fetch remote"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Tracked only"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["fetch", "tracked", [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

test("chooses a git remote to fetch from", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: git,
            remotes: () => ["origin", "upstream"],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    app.mockInput.pressKey("f")
    await app.waitForFrame((frame) => frame.includes("Fetch remote"))
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["fetch", undefined, [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

test("chooses a git remote to push to", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: git,
            remotes: () => ["origin", "upstream"],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    app.mockInput.pressKey("p")
    await app.waitForFrame((frame) => frame.includes("Push remote"))
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["push", undefined, [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

const gitBranches: VcsListEntry[] = [
  { id: "main", label: "main", name: "main", current: true, detail: "48b02f7f5c · latest" },
  { id: "feature", label: "feature", name: "feature", detail: "2c35b89292 · topic" },
  {
    id: "origin/feature",
    label: "origin/feature",
    name: "feature",
    remote: true,
    remoteName: "origin",
    detail: "2c35b89292 · topic",
  },
]

test("lists remote Git branches and pushes the matching local branch", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: git,
            branches: () => gitBranches,
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 36, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/b.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("Remote · 1") && frame.includes("origin/feature"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("origin/feature"))
    app.mockInput.pressKey("p")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["push", "feature", [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

test("switches from a remote Git branch through a tracking local branch", async () => {
  const switched: Array<{ ref: string; localName?: string }> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: git,
            branches: () => gitBranches,
            switchTo: (ref, options) => switched.push({ ref, localName: options?.localName }),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 36, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/b.ts"))
    app.mockInput.pressKey("3")
    await app.waitForFrame((frame) => frame.includes("Remote · 1") && frame.includes("origin/feature"))
    app.mockInput.pressArrow("down")
    app.mockInput.pressArrow("down")
    app.mockInput.pressEnter()
    await app.waitFor(() => switched.length === 1)
    expect(switched[0]).toEqual({ ref: "origin/feature", localName: "feature" })
  } finally {
    app.renderer.destroy()
  }
})

test("tracks or untracks all remote bookmarks", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              {
                id: "main@origin",
                label: "main@origin",
                name: "main",
                remote: true,
                remoteName: "origin",
                tracked: false,
                detail: "62730de940ae · current",
              },
            ],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
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
    await app.waitForFrame((frame) => frame.includes("s track all"))
    app.mockInput.pressKey("s")
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["track", "*", undefined, undefined])
    app.mockInput.pressKey("u")
    await app.waitForFrame((frame) => frame.includes("Untrack all remote bookmarks?"))
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 2)
    expect(executed[1]).toEqual(["untrack", "*", undefined, undefined])
  } finally {
    app.renderer.destroy()
  }
})

test("shows remote tracking information in the push dialog", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              { id: "main", label: "main", name: "main", current: true, detail: "62730de940ae · current" },
              {
                id: "main@origin",
                label: "main@origin",
                name: "main",
                remote: true,
                remoteName: "origin",
                tracked: true,
                detail: "62730de940ae · current",
              },
            ],
            remotes: () => ["origin", "upstream"],
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Local · 1"))
    app.mockInput.pressKey("p")
    await app.waitForFrame((frame) => frame.includes("Push remote") && frame.includes("main@origin tracked"))
  } finally {
    app.renderer.destroy()
  }
})

test("chooses a remote to push a bookmark to", async () => {
  const executed: Array<[VcsMutation, string | undefined, readonly string[] | undefined, string | undefined]> = []
  const app = await testRender(
    () => (
      <Providers>
        <VcsView
          controller={controller({
            summary: jj,
            branches: () => [
              { id: "main", label: "main", name: "main", detail: "62730de940ae · current" },
            ],
            remotes: () => ["origin", "upstream"],
            execute: (action, value, paths, remote) => executed.push([action, value, paths, remote]),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Local · 1"))
    app.mockInput.pressKey("p")
    await app.waitForFrame((frame) => frame.includes("Push remote") && frame.includes("upstream"))
    app.mockInput.pressEnter()
    await app.waitFor(() => executed.length === 1)
    expect(executed[0]).toEqual(["push", "main", [], "origin"])
  } finally {
    app.renderer.destroy()
  }
})

test("shows multiple bookmarks on separate lines in the repository preview", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <VcsView controller={controller({ summary: { ...jj, bookmarks: "main feature" } })} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts"))
    app.mockInput.pressKey("1")
    await app.waitForFrame((frame) => frame.includes("bookmark main") && frame.includes("bookmark feature"))
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
