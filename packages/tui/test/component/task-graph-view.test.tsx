/** @jsxImportSource @opentui/solid */
import { Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TaskGraph } from "@opencode/schema/task-graph"
import type { ParentProps } from "solid-js"
import { TaskGraphView, type TaskGraphVcsController } from "../../src/component/task-graph-view"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { RouteProvider } from "../../src/context/route"
import type { TaskGraphController } from "../../src/context/task-graph"
import { ThemeProvider } from "../../src/context/theme"
import { TuiI18nProvider } from "../../src/i18n"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { buildTaskGraph } from "../../src/util/task-graph"
import type { VcsSummary } from "../../src/util/vcs"
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

function controller(graph = dataset()): TaskGraphController {
  return {
    enabled: () => true,
    visible: () => true,
    sessionID: () => "ses_task_graph",
    goal: () => graph.goal,
    graph: () => graph,
    links: () => ({}),
    setLink: async () => {},
    removeLink: async () => {},
    refresh: async () => {},
  }
}

const jjSummary: VcsSummary = {
  kind: "jj",
  label: "main",
  detail: "clean",
  change: "head",
  dirty: 0,
  conflict: false,
  files: [],
}

const jjVcsStub: TaskGraphVcsController = {
  summary: () => jjSummary,
  resolveLinks: async () => ({}),
  newTaskChange: async () => "newchange",
  describeTask: async () => true,
  bookmarkTask: async () => true,
  editTask: async () => true,
  squashTask: async () => true,
  abandonTask: async () => true,
  isAncestor: async () => true,
}

const vcsStub: TaskGraphVcsController = {
  summary: () => undefined,
  resolveLinks: async () => ({}),
  newTaskChange: async () => undefined,
  describeTask: async () => false,
  bookmarkTask: async () => false,
  editTask: async () => false,
  squashTask: async () => false,
  abandonTask: async () => false,
  isAncestor: async () => false,
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
        <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
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
        <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
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
        <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
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
        <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
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


test("resizes the details pane from the divider", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    const before = () =>
      app
        .captureCharFrame()
        .split("\n")
        .find((row) => row.includes("Details"))
    await app.waitForFrame((frame) => frame.includes("Details") && frame.includes("Design the graph"))
    const divider = before()!.indexOf("Details")

    await app.mockMouse.pressDown(71, 10)
    await app.mockMouse.moveTo(61, 10)
    await app.mockMouse.release(61, 10)
    await app.waitForFrame((frame) => {
      const row = frame.split("\n").find((line) => line.includes("Details"))
      return row !== undefined && row.indexOf("Details") < divider
    })

    expect(before()!.indexOf("Details")).toBeLessThan(divider)
  } finally {
    app.renderer.destroy()
  }
})

test("fits the details pane inside a narrower view", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <box width="100%" height="100%" flexDirection="row">
          <box width={20} flexShrink={0}>
            <text>RAIL</text>
          </box>
          <box id="task-graph-host" flexGrow={1} minWidth={0}>
            <TaskGraphView controller={controller()} vcs={vcsStub} onClose={() => {}} />
          </box>
        </box>
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Details") && frame.includes("Design the graph"))
    const host = app.renderer.root.findDescendantById("task-graph-host")!
    const details = app.renderer.root.findDescendantById("task-graph-details")!

    expect(details.width).toBe(30)
    expect(details.x + details.width).toBeLessThanOrEqual(host.x + host.width)
  } finally {
    app.renderer.destroy()
  }
})

test("wraps long details instead of overflowing the pane", async () => {
  const reason = "R".repeat(90)
  const graph = buildTaskGraph({
    messages: [
      assistant("msg_1", [
        taskwrite([{ id: "blocked", title: "Blocked task", status: "blocked", dependsOn: [], reason }]),
      ]),
    ],
    running: true,
  })
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller(graph)} vcs={vcsStub} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Details") && frame.includes("Blocked task"))
    const frame = app.captureCharFrame()

    expect(frame).toContain("Reason")
    expect(frame).toContain(reason.slice(0, 10))
    expect(frame.split("\n").some((line) => line.includes(reason))).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

test("shows a linked jj change in the task row and details", async () => {
  const graph = buildTaskGraph({
    messages: [
      assistant("msg_1", [
        taskwrite([
          { id: "design", title: "Design the graph", status: "done", dependsOn: [] },
          { id: "build", title: "Build the view", status: "pending", dependsOn: ["design"] },
        ]),
      ]),
    ],
    vcsLinks: {
      design: {
        change: "znnsty",
        commit: "8f3a1c2",
        bookmarks: ["task/design"],
        description: "task(design): Design the graph",
        empty: false,
        conflict: true,
        immutable: false,
        parents: ["qpq"],
      },
    },
    vcsHead: "znnsty",
  })
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller(graph)} vcs={vcsStub} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("task/de") && frame.includes("Design the graph"))
    const frame = app.captureCharFrame()
    expect(frame).toContain("!")
    expect(frame).toContain("conflict")
    expect(frame).toContain("znnsty")
  } finally {
    app.renderer.destroy()
  }
})


test("opens the jj task action menu", async () => {
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={controller()} vcs={jjVcsStub} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Design the graph"))
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("Task actions") && frame.includes("New change"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("New jj change for task"))
  } finally {
    app.renderer.destroy()
  }
})


test("creates a change and links the selected task", async () => {
  const calls: string[] = []
  const base = controller()
  const linked: TaskGraphController = {
    ...base,
    setLink: async (taskID) => {
      calls.push(`link:${taskID}`)
    },
  }
  const vcs: TaskGraphVcsController = {
    ...jjVcsStub,
    newTaskChange: async (message) => {
      calls.push(`new:${message}`)
      return "newchange"
    },
    bookmarkTask: async (ref, bookmark) => {
      calls.push(`bookmark:${ref}:${bookmark}`)
      return true
    },
  }
  const app = await testRender(
    () => (
      <Providers>
        <TaskGraphView controller={linked} vcs={vcs} onClose={() => {}} />
      </Providers>
    ),
    { width: 110, height: 30, kittyKeyboard: true },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Design the graph"))
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("Task actions"))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("New jj change for task"))
    app.mockInput.pressEnter()
    await app.waitFor(() => calls.length === 3)
    expect(calls).toEqual([
      "new:task(design): Design the graph",
      "bookmark:newchange:task/design",
      "link:design",
    ])
  } finally {
    app.renderer.destroy()
  }
})
