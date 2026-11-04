/** @jsxImportSource @opentui/solid */
import { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TaskGraph } from "@opencode/schema/task-graph"
import type { ParentProps } from "solid-js"
import { TaskGraphView } from "../../src/component/task-graph-view"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { RouteProvider } from "../../src/context/route"
import type { TaskGraphController } from "../../src/context/task-graph"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { buildTaskGraph } from "../../src/util/task-graph"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const model = { id: "model", providerID: "provider" }

function assistant(id: string, content: SessionMessageAssistant["content"]): SessionMessageInfo {
  return {
    type: "assistant",
    id,
    agent: "build",
    model,
    time: { created: 1, completed: 2 },
    finish: "stop",
    content,
  } satisfies SessionMessageInfo
}

function taskwrite(tasks: TaskGraph.Task[]): SessionMessageAssistantTool {
  return {
    type: "tool",
    id: "tool-taskwrite",
    name: "taskwrite",
    time: { created: 0, completed: 1 },
    state: {
      status: "completed",
      input: { tasks: tasks.map((task) => ({ ...task, dependsOn: [...task.dependsOn] })) },
      content: [{ type: "text", text: "ok" }],
    },
  }
}

function dataset() {
  const messages = [
    assistant("msg_1", [
      taskwrite([
        { id: "design", title: "Design the graph", status: "done", dependsOn: [] },
        { id: "build", title: "Build the view", status: "active", dependsOn: ["design"] },
        { id: "verify", title: "Verify on CI", status: "blocked", dependsOn: ["build"], reason: "needs a release tag" },
      ]),
      {
        type: "tool",
        id: "tool-1",
        name: "read",
        time: { created: 2, completed: 3 },
        state: { status: "completed", input: { path: "src/component/task-graph-view.tsx" }, content: [{ type: "text", text: "ok" }] },
      },
    ]),
  ] satisfies SessionMessageInfo[]
  return buildTaskGraph({ messages, running: true })
}

function controller(): TaskGraphController {
  const graph = dataset()
  return {
    enabled: () => true,
    visible: () => true,
    sessionID: () => "ses_task_graph",
    goal: () => graph.goal,
    graph: () => graph,
    refresh: async () => {},
  }
}

function findScrollBoxes(node: Renderable): ScrollBoxRenderable[] {
  return [
    ...(node instanceof ScrollBoxRenderable ? [node] : []),
    ...node.getChildren().flatMap(findScrollBoxes),
  ]
}

function Providers(props: ParentProps) {
  return (
    <TestTuiContexts>
      <ConfigProvider config={createTuiResolvedConfig()}>
        <TuiI18nProvider>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <RouteProvider>{props.children}</RouteProvider>
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </TuiI18nProvider>
      </ConfigProvider>
    </TestTuiContexts>
  )
}

test("renders tasks, dependencies, and the selected detail", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame(
      (frame) =>
        frame.includes("Task graph") &&
        frame.includes("Design the graph") &&
        frame.includes("Build the view") &&
        frame.includes("Verify on CI"),
    )
    const frame = app.captureCharFrame()
    expect(frame).toContain("1/3 done")
    expect(frame).toContain("1 running")
    expect(frame).toContain("Details")
    expect(frame).toContain("Design the graph")
  } finally {
    app.renderer.destroy()
  }
})

test("keeps the selected node in view and shows its details", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Design the graph"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("Build the view") && frame.includes("running"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("needs a release tag") && frame.includes("blocked"))
  } finally {
    app.renderer.destroy()
  }
})

test("draws vertical scrollbars only", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Task graph"))
    const scrolls = findScrollBoxes(app.renderer.root)
    expect(scrolls.length).toBeGreaterThan(0)
    for (const scroll of scrolls) {
      expect(scroll.horizontalScrollBar.visible).toBe(false)
      expect(scroll.verticalScrollBar.visible).toBe(true)
    }
  } finally {
    app.renderer.destroy()
  }
})

test("uses the full width and hides the details pane on a narrow terminal", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} onClose={() => {}} />
      </Providers>
    ),
    { width: 70, height: 24, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Design the graph") && frame.includes("Build the view"))
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("Details")
    expect(frame).toContain("1/3 done")
  } finally {
    app.renderer.destroy()
  }
})
