/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { FileManagerDock, type FileManagerDockController } from "../../src/component/file-manager-dock"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function controller(overrides: Partial<FileManagerDockController> = {}): FileManagerDockController {
  return {
    visible: () => true,
    root: () => "/tmp/opencode/packages/tui",
    path: () => "",
    entries: () => [
      { path: "src", name: "src", type: "directory" },
      { path: "README.md", name: "README.md", type: "file" },
    ],
    loading: () => false,
    ...overrides,
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

test("shows the current directory and opens the file manager on click", async () => {
  const [opened, setOpened] = createSignal(0)
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <FileManagerDock
            orientation="right"
            width={30}
            onOpen={() => setOpened((value) => value + 1)}
            controller={controller()}
          />
        </box>
      </Providers>
    ),
    { width: 40, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("FILES") && frame.includes("tui") && frame.includes("2"))
    await app.mockMouse.click(2, 0)
    await app.waitFor(() => opened() === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the count legible in the compact vertical rail", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="row">
          <FileManagerDock orientation="vertical" width={5} controller={controller()} />
          <text>transcript</text>
        </box>
      </Providers>
    ),
    { width: 20, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("F") && frame.includes("2"))
    expect(app.captureCharFrame().split("\n")[0]?.slice(0, 5)).toBe("  F  ")
  } finally {
    app.renderer.destroy()
  }
})

test("shows the current path when the user navigates", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <FileManagerDock orientation="below" controller={controller({ path: () => "src/component" })} />
        </box>
      </Providers>
    ),
    { width: 100, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("FILES") && frame.includes("tui") && frame.includes("src/component"))
  } finally {
    app.renderer.destroy()
  }
})
