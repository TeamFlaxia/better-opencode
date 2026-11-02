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
import type { VcsMutation, VcsSummary } from "../../src/util/vcs"
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
