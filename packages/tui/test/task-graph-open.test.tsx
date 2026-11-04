import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_task_graph",
  title: "Task graph",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const message = {
  id: "msg_task_graph",
  type: "assistant",
  agent: "build",
  model: { providerID: "provider", id: "model" },
  time: { created: 1, completed: 2 },
  finish: "tool-calls",
  content: [
    {
      type: "tool",
      id: "tool_taskwrite",
      name: "taskwrite",
      time: { created: 1, completed: 2 },
      state: {
        status: "completed",
        input: {
          tasks: [
            { id: "design", title: "Design the graph", status: "done", dependsOn: [] },
            { id: "build", title: "Build the view", status: "active", dependsOn: ["design"] },
            { id: "verify", title: "Verify on CI", status: "pending", dependsOn: ["build"] },
          ],
        },
        content: [{ type: "text", text: "ok" }],
      },
    },
    {
      type: "tool",
      id: "tool_read",
      name: "read",
      time: { created: 2, completed: 3 },
      state: {
        status: "completed",
        input: { path: "src/component/task-graph-view.tsx" },
        content: [{ type: "text", text: "ok" }],
      },
    },
  ],
} satisfies SessionMessageInfo

test("shows the task graph dock from the session transcript", async () => {
  await using setup = await createAppFixture({
    width: 110,
    height: 32,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "on" }, experimental: { "task-graph": true } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [message], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("TASKS") && frame.includes("Build the view"))

  const frame = setup.captureCharFrame()
  expect(frame).toContain("1/3 done")
  expect(frame).toContain("Build the view")
  expect(frame).toContain("taskwrite")

  const rows = frame.split("\n")
  const dockRow = rows.findIndex((row) => row.includes("TASKS"))
  await setup.mockMouse.click(3, dockRow)
  await setup.waitForFrame(
    (next) => next.includes("Task graph") && next.includes("Design the graph") && next.includes("Verify on CI"),
  )
  const view = setup.captureCharFrame()
  expect(view).toContain("Depends on layer 1")
  expect(view).toContain("Details")

  setup.mockInput.pressKey("q")
  await setup.waitForFrame((next) => next.includes("TASKS") && next.includes("Build the view"))

  await setup.mockMouse.click(5, rows.length - 2)
  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey("j")
  await setup.waitForFrame((next) => next.includes("Task graph") && next.includes("Verify on CI"))
}, 20000)

test("keeps the dock visible before the session declares tasks", async () => {
  await using setup = await createAppFixture({
    width: 110,
    height: 32,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "on" }, experimental: { "task-graph": true } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("TASKS") && frame.includes("No tasks yet"))

  expect(setup.captureCharFrame()).toContain("no tasks")
}, 20000)
