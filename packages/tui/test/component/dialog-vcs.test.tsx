/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogVcs, type DialogVcsController } from "../../src/component/dialog-vcs"
import { DialogVcsFiles } from "../../src/component/dialog-vcs-files"
import { DialogVcsHunks } from "../../src/component/dialog-vcs-hunks"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import type { VcsMutation, VcsSummary } from "../../src/util/vcs"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function controller(summary: VcsSummary): DialogVcsController {
  return {
    summary: () => summary,
    refreshing: () => false,
    tool: () => undefined,
    refresh: async () => {},
    openTool: async () => {},
    openCommand: async () => {},
    execute: async () => {},
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

test.each([
  [
    "jj",
    {
      kind: "jj" as const,
      label: "main",
      detail: "fix tabs",
      dirty: 2,
      conflict: false,
      files: [{ file: "a.ts", status: "modified" as const, staged: false, unstaged: true }],
    },
    [
      "Create new change",
      "Describe current change",
      "Set bookmark",
      "Push bookmarks",
      "Split files into new change",
      "Split files into parallel change",
      "Split interactively",
    ],
  ],
  [
    "git",
    {
      kind: "git" as const,
      label: "main",
      detail: "2 changed files",
      dirty: 2,
      conflict: false,
      files: [
        { file: "a.ts", status: "modified" as const, staged: true, unstaged: false },
        { file: "b.ts", status: "added" as const, staged: false, unstaged: true },
      ],
    },
    [
      "Commit staged changes",
      "Commit all changes",
      "Stage files…",
      "Stage hunks…",
      "Unstage files…",
      "Unstage hunks…",
      "Fetch",
      "Pull",
      "Push",
    ],
  ],
])("lists built-in %s actions", async (_kind, summary, expected) => {
  const app = await testRender(
    () => (
      <Providers>
        <DialogVcs controller={controller(summary)} />
      </Providers>
    ),
    { width: 100, height: 50 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes(`Version control · ${summary.kind} main`) && expected.every((title) => frame.includes(title)),
    )
    expect(app.captureCharFrame()).toContain("Review changes")
  } finally {
    app.renderer.destroy()
  }
})

test("selects multiple files for a file action", async () => {
  const confirmed: string[][] = []
  const app = await testRender(
    () => (
      <Providers>
        <DialogVcsFiles
          title="Stage files"
          files={[
            { file: "src/a.ts", status: "modified", staged: false, unstaged: true },
            { file: "src/b.ts", status: "added", staged: false, unstaged: true },
          ]}
          onConfirm={(paths) => confirmed.push(paths)}
          onCancel={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 30 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src/a.ts") && frame.includes("src/b.ts"))
    app.mockInput.pressKey(" ")
    app.mockInput.pressArrow("down")
    app.mockInput.pressKey(" ")
    app.mockInput.pressEnter()
    await app.waitFor(() => confirmed[0]?.length === 2)
    expect(confirmed[0]).toEqual(["src/a.ts", "src/b.ts"])
  } finally {
    app.renderer.destroy()
  }
})

test("selects multiple hunks and returns only those hunks", async () => {
  const confirmed: string[] = []
  const header = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n"
  const patch = {
    header,
    hunks: [
      { header: "@@ -1 +1 @@", text: "@@ -1 +1 @@\n-one\n+two\n", additions: 1, deletions: 1 },
      { header: "@@ -5 +5 @@", text: "@@ -5 +5 @@\n-five\n+six\n", additions: 1, deletions: 1 },
    ],
  }
  const app = await testRender(
    () => (
      <Providers>
        <DialogVcsHunks
          title="Stage hunks"
          patch={patch}
          onConfirm={(value) => confirmed.push(value)}
          onCancel={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 30 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("@@ -1 +1 @@") && frame.includes("@@ -5 +5 @@"))
    app.mockInput.pressKey(" ")
    app.mockInput.pressArrow("down")
    app.mockInput.pressKey(" ")
    app.mockInput.pressEnter()
    await app.waitFor(() => confirmed.length === 1)
    expect(confirmed[0]).toBe(header + patch.hunks[0]!.text + patch.hunks[1]!.text)
  } finally {
    app.renderer.destroy()
  }
})

test("runs a selected built-in action", async () => {
  const executed: VcsMutation[] = []
  const summary: VcsSummary = { kind: "jj", label: "main", detail: "fix tabs", dirty: 2, conflict: false, files: [] }
  const base = controller(summary)
  const app = await testRender(
    () => (
      <Providers>
        <DialogVcs controller={{ ...base, execute: async (action) => void executed.push(action) }} />
      </Providers>
    ),
    { width: 100, height: 30 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Create new change"))
    const rows = app.captureCharFrame().split("\n")
    const row = rows.findIndex((line) => line.includes("Create new change"))
    await app.mockMouse.click(rows[row]?.indexOf("Create new change") ?? 2, row)
    await app.waitFor(() => executed[0] === "new")
  } finally {
    app.renderer.destroy()
  }
})
