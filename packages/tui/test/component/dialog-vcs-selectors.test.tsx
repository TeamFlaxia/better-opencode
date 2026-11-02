/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogVcsFiles } from "../../src/component/dialog-vcs-files"
import { DialogVcsHunks } from "../../src/component/dialog-vcs-hunks"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

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
