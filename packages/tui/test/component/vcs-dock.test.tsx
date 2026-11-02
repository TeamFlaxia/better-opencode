/** @jsxImportSource @opentui/solid */
import { MouseButton } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { VcsDock, type VcsDockController } from "../../src/component/vcs-dock"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import type { VcsSummary } from "../../src/util/vcs"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function controller(summary: VcsSummary, summaries: readonly VcsSummary[] = [summary]): VcsDockController {
  return {
    visible: () => true,
    summaries: () => summaries,
    summary: () => summary,
    refreshing: () => false,
    tool: () => ({ id: "lazyjj", label: "lazyjj", command: "/usr/bin/lazyjj" }),
    openTool: async () => {},
    refresh: async () => {},
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

test("shows jj status and opens the built-in version control view on click", async () => {
  const [opened, setOpened] = createSignal(0)
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <VcsDock
            orientation="right"
            width={30}
            onOpen={() => setOpened((value) => value + 1)}
            controller={controller({
              kind: "jj",
              label: "main",
              detail: "fix tabs",
              change: "znnsty",
              dirty: 2,
              conflict: false,
              files: [],
            })}
          />
        </box>
      </Providers>
    ),
    { width: 40, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("VCS") && frame.includes("jj") && frame.includes("main") && frame.includes("fix tabs"))
    expect(app.captureCharFrame()).toContain("2")
    await app.mockMouse.click(2, 0)
    await app.waitFor(() => opened() === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the status legible in the compact vertical rail", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="row">
          <VcsDock
            orientation="vertical"
            width={5}
            controller={controller({
              kind: "jj",
              label: "main",
              detail: "fix tabs",
              change: "znnsty",
              dirty: 2,
              conflict: false,
              files: [],
            })}
          />
          <text>transcript</text>
        </box>
      </Providers>
    ),
    { width: 20, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("V") && frame.includes("2"))
    expect(app.captureCharFrame().split("\n")[0]?.slice(0, 5)).toBe("  V  ")
  } finally {
    app.renderer.destroy()
  }
})

test("shows a conflict and exposes the menu on right click", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <VcsDock
            orientation="below"
            controller={controller({
              kind: "jj",
              label: "main",
              detail: "resolving",
              change: "znnsty",
              dirty: 1,
              conflict: true,
              files: [],
            })}
          />
        </box>
      </Providers>
    ),
    { width: 80, height: 24 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("VCS") && frame.includes("jj") && frame.includes("conflict"))
    await app.mockMouse.click(2, 0, MouseButton.RIGHT)
    await app.waitForFrame((frame) => frame.includes("Version control") && frame.includes("Open lazyjj"))
  } finally {
    app.renderer.destroy()
  }
})

test("labels a colocated jj and git repository with both kinds", async () => {
  const jj: VcsSummary = {
    kind: "jj",
    label: "main",
    detail: "1 changed file",
    change: "znnsty",
    dirty: 1,
    conflict: false,
    files: [],
  }
  const git: VcsSummary = {
    kind: "git",
    label: "main",
    detail: "clean",
    dirty: 0,
    conflict: false,
    files: [],
  }
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <VcsDock orientation="below" controller={controller(jj, [jj, git])} />
        </box>
      </Providers>
    ),
    { width: 80, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("jj+git"))
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the narrow right dock inside its width", async () => {
  const jj: VcsSummary = {
    kind: "jj",
    label: "lvnoszqwwumv",
    detail: "1 changed file",
    change: "lvnoszqwwumv",
    dirty: 1,
    conflict: false,
    files: [],
  }
  const git: VcsSummary = {
    kind: "git",
    label: "main",
    detail: "1 changed file",
    dirty: 1,
    conflict: false,
    files: [],
  }
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <VcsDock orientation="right" width={24} controller={controller(jj, [jj, git])} />
        </box>
      </Providers>
    ),
    { width: 24, height: 4 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("VCS") && frame.includes("jj+git"))
    const line = app.captureCharFrame().split("\n")[0]!
    expect(line.slice(0, 24)).toContain("VCS jj+git")
    expect(app.captureCharFrame()).not.toContain("1 changed file")
  } finally {
    app.renderer.destroy()
  }
})
