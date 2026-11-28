/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { DashboardDock } from "../../src/component/dashboard-dock"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
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

type DockProps = Parameters<typeof DashboardDock>[0]

function renderDock(dock: DockProps) {
  return testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <DashboardDock {...dock} />
        </box>
      </Providers>
    ),
    { width: 100, height: 4 },
  )
}

function locate(frame: string, needle: string) {
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes(needle))
  return { row, column: lines[row]?.indexOf(needle) ?? -1 }
}

test("renders the dashboard launcher with its label, hint and description", async () => {
  const app = await renderDock({ orientation: "right" })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("DASHBOARD") && frame.includes("⟨leader+d⟩"))
    expect(app.captureCharFrame()).toContain("Project dashboard")
  } finally {
    app.renderer.destroy()
  }
})

test("opens the dashboard when the launcher is clicked", async () => {
  const [opened, setOpened] = createSignal(false)
  const app = await renderDock({ orientation: "right", onOpen: () => setOpened(true) })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("DASHBOARD"))
    const { row, column } = locate(app.captureCharFrame(), "DASHBOARD")
    expect(column).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(column, row)
    await app.waitFor(() => opened())
  } finally {
    app.renderer.destroy()
  }
})

test("below variant is a single row and opens on click", async () => {
  const [opened, setOpened] = createSignal(false)
  const app = await renderDock({ orientation: "below", onOpen: () => setOpened(true) })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("DASHBOARD") && frame.includes("⟨leader+d⟩"))
    expect(app.captureCharFrame()).not.toContain("Project dashboard")
    const { row, column } = locate(app.captureCharFrame(), "DASHBOARD")
    expect(column).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(column, row)
    await app.waitFor(() => opened())
  } finally {
    app.renderer.destroy()
  }
})

test("compact vertical variant reduces to a letter and arrow", async () => {
  const [opened, setOpened] = createSignal(false)
  const app = await renderDock({ orientation: "vertical", width: 8, onOpen: () => setOpened(true) })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("▸"))
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("DASHBOARD")
    expect(frame).not.toContain("⟨leader+d⟩")
    const { row, column } = locate(frame, "▸")
    expect(column).toBeGreaterThanOrEqual(0)
    await app.mockMouse.click(column, row)
    await app.waitFor(() => opened())
  } finally {
    app.renderer.destroy()
  }
})
