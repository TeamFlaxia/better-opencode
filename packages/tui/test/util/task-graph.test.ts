import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TaskGraph } from "@opencode/schema/task-graph"
import {
  buildTaskGraph,
  graphColor,
  statusMarker,
  summarizeGraph,
  taskGraphDeclaredAt,
} from "../../src/util/task-graph"
import { jjLinkRevset, matchJjLinks, parseJjLinks } from "../../src/util/vcs"

const model = { id: "model", providerID: "provider" }

function assistant(
  id: string,
  content: SessionMessageAssistant["content"],
  input: { created?: number; completed?: number; tokens?: number } = {},
): SessionMessageInfo {
  return {
    type: "assistant",
    id,
    agent: "build",
    model,
    time: { created: input.created ?? 0, completed: input.completed },
    finish: input.completed === undefined ? undefined : "stop",
    content,
    tokens: input.tokens
      ? {
          input: input.tokens,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        }
      : undefined,
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

function completedTool(id: string, path: string): SessionMessageAssistantTool {
  return {
    type: "tool",
    id,
    name: "read",
    time: { created: 2, ran: 3, completed: 4 },
    state: {
      status: "completed",
      input: { path },
      content: [{ type: "text", text: "ok" }],
    },
  }
}

test("reads the latest completed taskwrite call", () => {
  const messages = [
    assistant("msg_1", [taskwrite([{ id: "a", title: "First", status: "done", dependsOn: [] }])]),
    assistant("msg_2", [taskwrite([{ id: "b", title: "Second", status: "active", dependsOn: ["a"], reason: "x" }])]),
  ]

  expect(TaskGraph.latest(messages)).toEqual([
    { id: "b", title: "Second", status: "active", dependsOn: ["a"], reason: "x" },
  ])
})

test("falls back to the latest todowrite list", () => {
  const messages = [
    assistant("msg_1", [
      {
        type: "tool",
        id: "tool-todo",
        name: "todowrite",
        time: { created: 0, completed: 1 },
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "Read", status: "completed" },
              { content: "Write", status: "in_progress" },
            ],
          },
          content: [{ type: "text", text: "ok" }],
        },
      },
    ]),
  ]

  const graph = buildTaskGraph({ messages, running: true })
  expect(graph.tasks.map((task) => [task.title, task.status])).toEqual([
    ["Write", "running"],
    ["Read", "done"],
  ])
})

test("resolves readiness, dependencies, blocked and skipped tasks", () => {
  const messages = [
    assistant("msg_1", [
      taskwrite([
        { id: "design", title: "Design", status: "done", dependsOn: [] },
        { id: "build", title: "Build", status: "pending", dependsOn: ["design"] },
        { id: "verify", title: "Verify", status: "pending", dependsOn: ["build"] },
        { id: "blocked", title: "Blocked", status: "blocked", dependsOn: [], reason: "needs a key" },
      ]),
    ]),
  ]

  const graph = buildTaskGraph({ messages, running: true })
  const byId = Object.fromEntries(graph.tasks.map((task) => [task.id, task]))
  expect(byId.design!.status).toBe("done")
  expect(byId.build!.status).toBe("ready")
  expect(byId.verify!.status).toBe("pending")
  expect(byId.verify!.layer).toBe(2)
  expect(byId.blocked!.status).toBe("blocked")
  expect(byId.blocked!.reason).toBe("needs a key")
  expect(graph.dependents.design).toEqual(["build"])
  expect(graphColor(graph)).toBe("blocked")

  const complete = buildTaskGraph({
    messages,
    goal: {
      id: "goal",
      objective: "Ship",
      status: "complete",
      rounds: 1,
      maxRounds: 10,
      boot: "boot",
      updatedAt: 1,
    },
  })
  expect(complete.tasks.find((task) => task.id === "build")!.status).toBe("skipped")
  expect(complete.tasks.find((task) => task.id === "verify")!.status).toBe("skipped")
})

test("marks an active task stalled when no execution runs, and running when it does", () => {
  const messages = [
    assistant("msg_1", [taskwrite([{ id: "work", title: "Work", status: "active", dependsOn: [] }])]),
  ]

  expect(buildTaskGraph({ messages, running: false }).tasks[0]!.status).toBe("stalled")
  expect(buildTaskGraph({ messages, running: true }).tasks[0]!.status).toBe("running")
  expect(buildTaskGraph({ messages, running: true, waiting: true }).tasks[0]!.status).toBe("waiting")
})

test("derives step and tool execution nodes", () => {
  const messages = [
    assistant("msg_1", [taskwrite([{ id: "work", title: "Work", status: "active", dependsOn: [] }])], {
      created: 1,
      completed: 2,
      tokens: 10,
    }),
    assistant("msg_2", [completedTool("tool-1", "src/a.ts")], { created: 3, completed: 4 }),
  ]

  const graph = buildTaskGraph({ messages, running: false })
  expect(graph.execution.map((node) => [node.kind, node.title, node.status])).toEqual([
    ["step", "Step 1", "done"],
    ["step", "Step 2", "done"],
    ["tool", "read", "done"],
  ])
  expect(graph.execution[0]!.tokens).toBe(10)
  expect(graph.execution[2]!.detail).toBe("src/a.ts")
})

test("rejects duplicate ids, unknown dependencies, and cycles", () => {
  expect(TaskGraph.issues([{ id: "a", title: "A", status: "pending", dependsOn: [] }])).toBeUndefined()
  expect(
    TaskGraph.issues([
      { id: "a", title: "A", status: "pending", dependsOn: [] },
      { id: "a", title: "B", status: "pending", dependsOn: [] },
    ]),
  ).toContain("unique")
  expect(TaskGraph.issues([{ id: "a", title: "A", status: "pending", dependsOn: ["b"] }])).toContain("unknown")
  expect(
    TaskGraph.issues([
      { id: "a", title: "A", status: "pending", dependsOn: ["b"] },
      { id: "b", title: "B", status: "pending", dependsOn: ["a"] },
    ]),
  ).toContain("cycle")
})

test("summarizes the graph and picks an unambiguous marker", () => {
  const graph = buildTaskGraph({
    messages: [
      assistant("msg_1", [
        taskwrite([
          { id: "a", title: "A", status: "done", dependsOn: [] },
          { id: "b", title: "B", status: "active", dependsOn: ["a"] },
        ]),
      ]),
    ],
    running: true,
  })

  expect(summarizeGraph(graph)).toContain("1/2 done")
  expect(summarizeGraph(graph)).toContain("1 running")
  expect(statusMarker("done")).toBe("[✓]")
  expect(statusMarker("blocked")).toBe("[!]")
})


test("parses jj links and resolves task references", () => {
  const output = [
    ["znnsty", "8f3a1c2", "task/build main", "task(build): Build", "true", "false", "false", "qpq"].join("\t"),
    ["qpq", "1111111", "", "base", "false", "true", "false", ""].join("\t"),
  ].join("\n")

  const links = parseJjLinks(output)
  expect(links).toEqual([
    {
      change: "znnsty",
      commit: "8f3a1c2",
      bookmarks: ["task/build", "main"],
      description: "task(build): Build",
      empty: true,
      conflict: false,
      immutable: false,
      parents: ["qpq"],
    },
    {
      change: "qpq",
      commit: "1111111",
      bookmarks: [],
      description: "base",
      empty: false,
      conflict: true,
      immutable: false,
      parents: [],
    },
  ])
  expect(jjLinkRevset([{ key: "build", bookmark: "task/build" }, { key: "base", change: "qpq" }])).toBe(
    'bookmarks("task/build") | qpq',
  )
  expect(matchJjLinks([{ key: "build", bookmark: "task/build" }, { key: "base", change: "qpq" }], links)).toEqual({
    build: links[0],
    base: links[1],
  })
})

test("merges a TUI link over the taskwrite link when it is newer", () => {
  const messages = [
    assistant(
      "msg_1",
      [taskwrite([{ id: "build", title: "Build", status: "active", dependsOn: [], bookmark: "task/old" }])],
      { created: 10, completed: 11 },
    ),
  ]
  const vcsLinks = {
    build: {
      change: "znnsty",
      commit: "8f3a1c2",
      bookmarks: ["task/build"],
      description: "task(build): Build",
      empty: false,
      conflict: true,
      immutable: false,
      parents: ["qpq"],
    },
  }

  expect(taskGraphDeclaredAt(messages)).toBe(10)
  const graph = buildTaskGraph({
    messages,
    running: true,
    declaredAt: 10,
    links: { build: { change: "znnsty", bookmark: "task/build", updatedAt: 20 } },
    vcsLinks,
    vcsHead: "znnsty",
  })
  expect(graph.tasks[0]!.vcs).toMatchObject({
    change: "znnsty",
    ref: "task/build",
    current: true,
    conflict: true,
  })

  const older = buildTaskGraph({
    messages,
    running: true,
    declaredAt: 10,
    links: { build: { bookmark: "task/stale", updatedAt: 5 } },
    vcsLinks,
    vcsHead: "znnsty",
  })
  expect(older.tasks[0]!.vcs).toMatchObject({ ref: "task/build", current: true })
})

test("marks an explicitly linked but missing change as broken", () => {
  const messages = [
    assistant(
      "msg_1",
      [taskwrite([{ id: "build", title: "Build", status: "active", dependsOn: [], change: "missing" }])],
    ),
  ]
  const graph = buildTaskGraph({ messages, running: true })
  expect(graph.tasks[0]!.vcs).toMatchObject({ ref: "missing", broken: true, current: false })
})
