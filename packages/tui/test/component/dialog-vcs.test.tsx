/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogVcs, type DialogVcsController } from "../../src/component/dialog-vcs"
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
    execute: async () => {},
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
    { kind: "jj" as const, label: "main", detail: "fix tabs", dirty: 2, conflict: false },
    ["Create new change", "Describe current change", "Set bookmark", "Push bookmarks"],
  ],
  [
    "git",
    { kind: "git" as const, label: "main", detail: "2 changed files", dirty: 2, conflict: false },
    ["Commit all changes", "Fetch", "Pull", "Push"],
  ],
])("lists built-in %s actions", async (_kind, summary, expected) => {
  const app = await testRender(
    () => (
      <Providers>
        <DialogVcs controller={controller(summary)} />
      </Providers>
    ),
    { width: 100, height: 30 },
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

test("runs a selected built-in action", async () => {
  const executed: VcsMutation[] = []
  const summary: VcsSummary = { kind: "jj", label: "main", detail: "fix tabs", dirty: 2, conflict: false }
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
