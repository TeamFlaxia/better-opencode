/** @jsxImportSource @opentui/solid */
import type { AbsolutePath } from "@opencode/schema"
import type { Project } from "@opencode/schema/project"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount, type ParentProps } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ProjectDashboardView, type ProjectDashboardViewProps } from "../../src/component/dashboard"
import { DialogProject } from "../../src/component/dialog-project"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider, useTheme } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const NOW = Date.UTC(2026, 0, 31, 12)

function project(id: string, canonical: string, name?: string): Project.Info {
  return {
    id: id as Project.ID,
    canonical: canonical as AbsolutePath,
    name,
    time: { created: NOW - 90 * 86_400_000, updated: NOW - 86_400_000, active: NOW },
    sandboxes: [],
  }
}

const projects: Project.Info[] = [
  project("theia-code", "/work/theia-code", "Theia Code"),
  project("opencode", "/work/opencode", "OpenCode"),
  project("unnamed-playground", "/work/unnamed-playground"),
]

const folder = { id: "theia-code" as Project.ID, canonical: "/work/theia-code", name: "Theia Code" }

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

function View(props: Omit<ProjectDashboardViewProps, "theme">) {
  return <ProjectDashboardView {...props} theme={useTheme()} />
}

type ViewProps = Omit<ProjectDashboardViewProps, "theme">

function viewProps(overrides: Partial<ViewProps> = {}): ViewProps {
  return {
    sessions: [],
    range: "30d",
    width: 120,
    loading: false,
    projects,
    currentProject: folder,
    onRangeChange: () => {},
    onRefresh: () => {},
    onOpenSession: () => {},
    ...overrides,
  }
}

function renderView(overrides: Partial<ViewProps> = {}) {
  const props = viewProps(overrides)
  return testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="column">
          <View {...props} />
        </box>
      </Providers>
    ),
    { width: 120, height: 24, kittyKeyboard: true },
  )
}

function locate(frame: string, needle: string) {
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes(needle))
  return { row, column: lines[row]?.indexOf(needle) ?? -1 }
}

test("renders the All projects ⇆ name indicator on a single line", async () => {
  const app = await renderView()

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("All projects") && frame.includes("⇆"))
    const frame = app.captureCharFrame()
    const all = locate(frame, "All projects")
    const swap = locate(frame, "⇆")
    const name = locate(frame, "Theia Code")
    expect(all.row).toBeGreaterThanOrEqual(0)
    expect(swap.row).toBe(all.row)
    expect(name.row).toBe(all.row)
  } finally {
    app.renderer.destroy()
  }
})

test("shows the selected project name, or the current folder's name or basename", async () => {
  const cases: Array<[Partial<ViewProps>, string]> = [
    [{}, "Theia Code"],
    [{ project: "opencode" as Project.ID }, "OpenCode"],
    [{ project: "unnamed-playground" as Project.ID }, "unnamed-playground"],
    [{ currentProject: { id: "solo" as Project.ID, canonical: "/work/solo-work" } }, "solo-work"],
    [{ currentProject: undefined }, "This folder"],
  ]

  for (const [overrides, expected] of cases) {
    const app = await renderView(overrides)
    try {
      app.renderer.start()
      await app.waitForFrame((frame) => frame.includes("All projects") && frame.includes("⇆"))
      expect(app.captureCharFrame()).toContain(expected)
    } finally {
      app.renderer.destroy()
    }
  }
})

test("All projects clears the selection, the name picks the folder, ⇆ opens the picker", async () => {
  const changes: (Project.ID | undefined)[] = []
  let pickerOpens = 0
  const app = await renderView({
    project: "opencode" as Project.ID,
    onProjectChange: (value) => changes.push(value),
    onOpenProjectPicker: () => {
      pickerOpens++
    },
  })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("All projects") && frame.includes("OpenCode"))

    const all = locate(app.captureCharFrame(), "All projects")
    expect(all.column).toBeGreaterThanOrEqual(0)
    app.renderer.clearSelection()
    await app.mockMouse.click(all.column, all.row)
    await app.waitFor(() => changes.length === 1)
    expect(changes[0]).toBeUndefined()

    const name = locate(app.captureCharFrame(), "OpenCode")
    expect(name.column).toBeGreaterThanOrEqual(0)
    app.renderer.clearSelection()
    await app.mockMouse.click(name.column, name.row)
    await app.waitFor(() => changes.length === 2)
    expect(changes[1]).toBe("theia-code" as Project.ID)

    const swap = locate(app.captureCharFrame(), "⇆")
    expect(swap.column).toBeGreaterThanOrEqual(0)
    app.renderer.clearSelection()
    await app.mockMouse.click(swap.column, swap.row)
    await app.waitFor(() => pickerOpens === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("p opens the project picker", async () => {
  let pickerOpens = 0
  const app = await renderView({
    onOpenProjectPicker: () => {
      pickerOpens++
    },
  })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("All projects"))
    app.mockInput.pressKey("p")
    await app.waitFor(() => pickerOpens === 1)
  } finally {
    app.renderer.destroy()
  }
})

test("ignores keyboard shortcuts while the picker is open", async () => {
  let refreshes = 0
  let pickerOpens = 0
  const changes: (Project.ID | undefined)[] = []
  const app = await renderView({
    pickerOpen: true,
    onRefresh: () => {
      refreshes++
    },
    onOpenProjectPicker: () => {
      pickerOpens++
    },
    onProjectChange: (value) => changes.push(value),
  })

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("All projects"))
    app.mockInput.pressKey("r")
    app.mockInput.pressKey("p")
    await app.renderOnce()
    expect(refreshes).toBe(0)
    expect(pickerOpens).toBe(0)
    expect(changes.length).toBe(0)
  } finally {
    app.renderer.destroy()
  }
})

function renderDialog(onSelect: (project: Project.ID | undefined) => void) {
  return testRender(
    () => (
      <Providers>
        {(() => {
          const dialog = useDialog()
          onMount(() => dialog.replace(() => <DialogProject projects={projects} onSelect={onSelect} />))
          return null
        })()}
      </Providers>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
}

test("DialogProject lists All projects plus the project entries", async () => {
  const app = await renderDialog(() => {})

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("Project") &&
        frame.includes("All projects") &&
        frame.includes("Theia Code") &&
        frame.includes("OpenCode"),
    )
    const frame = app.captureCharFrame()
    expect(frame).toContain("unnamed-playground")
    expect(frame).toContain("/work/opencode")
  } finally {
    app.renderer.destroy()
  }
})

test("DialogProject returns the chosen project id", async () => {
  const selected: (Project.ID | undefined)[] = []
  const app = await renderDialog((value) => selected.push(value))

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("OpenCode"))
    const target = locate(app.captureCharFrame(), "OpenCode")
    expect(target.column).toBeGreaterThanOrEqual(0)
    app.renderer.clearSelection()
    await app.mockMouse.click(target.column, target.row)
    await app.waitFor(() => selected.length === 1)
    expect(selected[0]).toBe("opencode" as Project.ID)
  } finally {
    app.renderer.destroy()
  }
})

test("DialogProject returns undefined for All projects", async () => {
  const selected: (Project.ID | undefined)[] = []
  const app = await renderDialog((value) => selected.push(value))

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("All projects"))
    const target = locate(app.captureCharFrame(), "All projects")
    expect(target.column).toBeGreaterThanOrEqual(0)
    app.renderer.clearSelection()
    await app.mockMouse.click(target.column, target.row)
    await app.waitFor(() => selected.length === 1)
    expect(selected[0]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})
