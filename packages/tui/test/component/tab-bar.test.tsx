/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { TabBar, type WorkspaceTab } from "../../src/component/tab-bar"
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

test("renders both workspace tabs and selects the dashboard on click", async () => {
  const [selected, setSelected] = createSignal<WorkspaceTab>("chat")
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <TabBar tab={selected()} onSelect={(tab) => setSelected(tab)} />
          <text>transcript</text>
        </box>
      </Providers>
    ),
    { width: 100, height: 3 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Chat") && frame.includes("Dashboard"))
    const lines = app.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes("Dashboard"))
    expect(row).toBe(0)
    const column = lines[row]?.indexOf("Dashboard") ?? -1
    expect(column).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(column, row)
    await app.waitFor(() => selected() === "dashboard")
  } finally {
    app.renderer.destroy()
  }
})

test("shortens the dashboard label on narrow terminals", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <TabBar tab="chat" onSelect={() => {}} />
          <text>transcript</text>
        </box>
      </Providers>
    ),
    { width: 40, height: 3 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Chat") && frame.includes("Dash"))
    expect(app.captureCharFrame()).not.toContain("Dashboard")
  } finally {
    app.renderer.destroy()
  }
})
