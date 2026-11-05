/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createMemo, createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { FileManagerView, type FileManagerController } from "../../src/component/file-manager-view"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import type { FileManagerEntry } from "../../src/util/file-manager"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const entries: FileManagerEntry[] = [
  { path: "src", name: "src", type: "directory" },
  { path: "README.md", name: "README.md", type: "file" },
]

function controller(overrides: Partial<FileManagerController> = {}): FileManagerController {
  return {
    root: () => "/tmp/opencode",
    path: () => "",
    entries: () => entries,
    loading: () => false,
    error: () => undefined,
    revision: () => 0,
    open: () => {},
    up: () => {},
    refresh: async () => {},
    preview: async (file) => ({
      text: `contents of ${file}`,
      bytes: 24,
      binary: false,
      truncated: false,
    }),
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

test("lists entries and previews the selected file", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <FileManagerView controller={controller()} onClose={() => {}} />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("File manager") &&
        frame.includes("Directory · 2") &&
        frame.includes("src") &&
        frame.includes("README.md"),
    )
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("contents of README.md"))
    expect(app.captureCharFrame()).toContain("24 B")
  } finally {
    app.renderer.destroy()
  }
})

test("opens directories and returns to the parent", async () => {
  const [path, setPath] = createSignal("")
  const current = createMemo(() => (path() ? [] : entries))
  const opened: string[] = []
  const app = await testRender(
    () => (
      <Providers>
        <FileManagerView
          controller={controller({
            path,
            entries: current,
            open: (next) => {
              opened.push(next)
              setPath(next)
            },
            up: () => setPath(""),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src") && frame.includes("README.md"))
    app.mockInput.pressEnter()
    await app.waitFor(() => opened.length === 1)
    expect(opened).toEqual(["src"])
    await app.waitForFrame((frame) => frame.includes("Directory · 0") && frame.includes("parent"))
    app.mockInput.pressBackspace()
    await app.waitForFrame((frame) => frame.includes("src") && frame.includes("README.md"))
  } finally {
    app.renderer.destroy()
  }
})

test("copies the absolute path of the selected entry", async () => {
  const copied: string[] = []
  const app = await testRender(
    () => (
      <TestTuiContexts
        clipboard={{
          read: async () => undefined,
          write: async (value) => {
            copied.push(value)
          },
        }}
      >
        <ConfigProvider config={createTuiResolvedConfig()}>
          <TuiI18nProvider>
            <Keymap.Provider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
                <ToastProvider>
                  <DialogProvider>
                    <FileManagerView controller={controller()} onClose={() => {}} />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </TuiI18nProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("src") && frame.includes("README.md"))
    app.mockInput.pressKey("y")
    await app.waitFor(() => copied.length === 1)
    expect(copied[0]).toBe("/tmp/opencode/src")
  } finally {
    app.renderer.destroy()
  }
})

test("shows binary files without decoding them", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <FileManagerView
          controller={controller({
            entries: () => [{ path: "image.png", name: "image.png", type: "file" }],
            preview: async () => ({ text: "", bytes: 2048, binary: true, truncated: false }),
          })}
          onClose={() => {}}
        />
      </Providers>
    ),
    { width: 100, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("image.png") && frame.includes("Binary file") && frame.includes("2.0 KB"))
  } finally {
    app.renderer.destroy()
  }
})
