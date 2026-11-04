import type { Goal } from "@opencode/schema/goal"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TaskGraph } from "@opencode/schema/task-graph"
import { TaskLink } from "@opencode/schema/task-link"
import type { VcsLinkInfo } from "./vcs"
import { sessionTodos } from "./todo"

export type TaskNodeKind = "goal" | "task" | "step" | "tool" | "subagent"

export type TaskNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "stalled"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped"

export type TaskNode = {
  id: string
  kind: TaskNodeKind
  title: string
  status: TaskNodeStatus
  dependsOn: string[]
  reason?: string
  detail?: string
  layer: number
  sessionID?: string
  messageID?: string
  started?: number
  completed?: number
  tokens?: number
  cost?: number
  vcs?: VcsLinkInfo & { ref: string; current: boolean; broken?: boolean }
}

export type TaskGraphModel = {
  goal?: Goal.State
  tasks: TaskNode[]
  execution: TaskNode[]
  dependents: Record<string, string[]>
  counts: {
    total: number
    done: number
    active: number
    blocked: number
    stalled: number
    waiting: number
    pending: number
    cancelled: number
    skipped: number
    runningExecution: number
  }
  current?: TaskNode
}

export type SessionSummary = {
  id: string
  title?: string
  parentID?: string
  status: "running" | "idle"
  waiting?: boolean
}

/**
 * Builds the viewer model from the Session's declared tasks and observed execution. Declared tasks come from the
 * latest `taskwrite` call, with `todowrite` as a fallback for sessions that predate it.
 */
export function buildTaskGraph(input: {
  messages: ReadonlyArray<SessionMessageInfo>
  goal?: Goal.State
  sessions?: ReadonlyArray<SessionSummary>
  running?: boolean
  waiting?: boolean
  links?: Readonly<Record<string, TaskLink.Link>>
  vcsLinks?: Readonly<Record<string, VcsLinkInfo>>
  vcsHead?: string
  declaredAt?: number
}): TaskGraphModel {
  const execution = buildExecution(input.messages, input.sessions ?? [], input.running === true)
  const runningExecution = execution.some((node) => node.status === "running")
  const declared = declaredTasks(input.messages)
  const layers = taskLayers(declared)
  const dependents = dependentsOf(declared)
  const tasks = declared.map((task): TaskNode => {
    const status = taskStatus(task, {
      goal: input.goal,
      running: input.running === true || runningExecution,
      waiting: input.waiting === true,
      done: new Set(declared.filter((item) => item.status === "done").map((item) => item.id)),
    })
    const link = resolveLink(task, input.links?.[task.id], input.declaredAt)
    const vcs = vcsFor(link, input.vcsLinks?.[task.id], input.vcsHead)
    return {
      id: task.id,
      kind: "task",
      title: task.title,
      status,
      dependsOn: [...task.dependsOn],
      reason: taskReason(task, status, input.goal),
      detail: detailFor(task),
      layer: layers.get(task.id) ?? 0,
      vcs,
    }
  })
  tasks.sort(byLayerThenStatus)
  const counts = {
    total: tasks.length,
    done: tasks.filter((node) => node.status === "done").length,
    active: tasks.filter((node) => node.status === "running").length,
    blocked: tasks.filter((node) => node.status === "blocked").length,
    stalled: tasks.filter((node) => node.status === "stalled").length,
    waiting: tasks.filter((node) => node.status === "waiting").length,
    pending: tasks.filter((node) => node.status === "pending" || node.status === "ready").length,
    cancelled: tasks.filter((node) => node.status === "cancelled").length,
    skipped: tasks.filter((node) => node.status === "skipped").length,
    runningExecution: execution.filter((node) => node.status === "running").length,
  }
  const current =
    tasks.find((node) => node.status === "running") ??
    execution.find((node) => node.status === "running") ??
    tasks.find((node) => node.status === "waiting" || node.status === "blocked" || node.status === "stalled")
  return { goal: input.goal, tasks, execution, dependents, counts, current }
}

/** A one-line summary for the dock and the view header. */
export function summarizeGraph(model: TaskGraphModel) {
  const parts = [
    model.counts.total > 0 ? `${model.counts.done}/${model.counts.total} done` : "no tasks",
    ...(model.counts.active ? [`${model.counts.active} running`] : []),
    ...(model.counts.waiting ? [`${model.counts.waiting} waiting`] : []),
    ...(model.counts.blocked ? [`${model.counts.blocked} blocked`] : []),
    ...(model.counts.stalled ? [`${model.counts.stalled} stalled`] : []),
    ...(model.counts.pending ? [`${model.counts.pending} pending`] : []),
    ...(model.counts.skipped ? [`${model.counts.skipped} skipped`] : []),
  ]
  return parts.join(" · ")
}

/** The worst status decides the dock color, so a single blocked task stays visible. */
export function graphColor(model: TaskGraphModel): TaskNodeStatus | undefined {
  if (model.counts.blocked > 0) return "blocked"
  if (model.counts.stalled > 0) return "stalled"
  if (model.counts.waiting > 0) return "waiting"
  if (model.counts.active > 0 || model.counts.runningExecution > 0) return "running"
  if (model.goal?.status === "complete") return "done"
  if (model.counts.total > 0 && model.counts.done === model.counts.total) return "done"
  return model.counts.total > 0 ? "pending" : undefined
}

export function statusMarker(status: TaskNodeStatus) {
  if (status === "done") return "[✓]"
  if (status === "running") return "[>]"
  if (status === "ready") return "[·]"
  if (status === "waiting") return "[~]"
  if (status === "blocked" || status === "stalled") return "[!]"
  if (status === "failed") return "[×]"
  if (status === "cancelled" || status === "skipped") return "[-]"
  return "[ ]"
}

export function statusLabel(status: TaskNodeStatus) {
  if (status === "done") return "done"
  if (status === "running") return "running"
  if (status === "ready") return "ready"
  if (status === "waiting") return "waiting"
  if (status === "blocked") return "blocked"
  if (status === "stalled") return "stalled"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "skipped") return "skipped"
  return "pending"
}

type ResolvedLink = { bookmark?: string; change?: string; explicit: boolean }

function resolveLink(
  task: TaskGraph.Task,
  stored: TaskLink.Link | undefined,
  declaredAt: number | undefined,
): ResolvedLink {
  const message = task.bookmark || task.change ? { bookmark: task.bookmark, change: task.change } : undefined
  if (stored && (declaredAt === undefined || stored.updatedAt >= declaredAt) && (stored.bookmark || stored.change)) {
    return { bookmark: stored.bookmark ?? message?.bookmark, change: stored.change ?? message?.change, explicit: true }
  }
  if (message) return { ...message, explicit: true }
  if (stored?.bookmark || stored?.change) return { bookmark: stored.bookmark, change: stored.change, explicit: true }
  return { explicit: false }
}

function vcsFor(link: ResolvedLink, found: VcsLinkInfo | undefined, head: string | undefined) {
  if (found) return { ...found, ref: found.bookmarks[0] ?? link.bookmark ?? found.change, current: found.change === head }
  const ref = link.bookmark ?? link.change
  if (!ref) return undefined
  return {
    change: "",
    commit: "",
    bookmarks: [],
    description: "",
    empty: false,
    conflict: false,
    immutable: false,
    parents: [],
    ref,
    current: false,
    broken: true,
  }
}

/** The time of the latest completed taskwrite call, used to decide whether a TUI link is newer. */
export function taskGraphDeclaredAt(messages: ReadonlyArray<SessionMessageInfo>): number | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type !== "assistant") continue
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
      const part = message.content[partIndex]
      if (part?.type === "tool" && part.name === "taskwrite" && part.state.status === "completed")
        return message.time.created
    }
  }
  return undefined
}

function declaredTasks(messages: ReadonlyArray<SessionMessageInfo>): TaskGraph.Task[] {
  const declared = TaskGraph.latest(messages)
  if (declared.length > 0) return declared
  return sessionTodos(messages).map((todo, index) => ({
    id: `todo-${index + 1}`,
    title: todo.content,
    status:
      todo.status === "in_progress"
        ? "active"
        : todo.status === "completed"
          ? "done"
          : todo.status === "cancelled"
            ? "cancelled"
            : "pending",
    dependsOn: [],
  }))
}

function taskStatus(
  task: TaskGraph.Task,
  input: {
    goal?: Goal.State
    running: boolean
    waiting: boolean
    done: ReadonlySet<string>
  },
): TaskNodeStatus {
  if (task.status === "cancelled") return "cancelled"
  if (task.status === "done") return "done"
  if (input.goal?.status === "complete") return "skipped"
  if (task.status === "blocked") return "blocked"
  if (task.status === "active") {
    if (input.waiting) return "waiting"
    if (input.running) return "running"
    return "stalled"
  }
  return task.dependsOn.every((dependency) => input.done.has(dependency)) ? "ready" : "pending"
}

function taskReason(task: TaskGraph.Task, status: TaskNodeStatus, goal?: Goal.State) {
  if (task.reason) return task.reason
  if (status === "waiting") return "Waiting for the user"
  if (status === "stalled") return goal?.status === "paused" ? (goal.reason ?? "Goal paused") : "No execution is running"
  if (status === "skipped") return "The goal completed"
  if (status === "pending" && task.dependsOn.length > 0) return `Waiting on ${task.dependsOn.join(", ")}`
  return undefined
}

function detailFor(task: TaskGraph.Task) {
  const parts = [
    task.dependsOn.length ? `depends on ${task.dependsOn.join(", ")}` : undefined,
    task.reason,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function buildExecution(
  messages: ReadonlyArray<SessionMessageInfo>,
  sessions: ReadonlyArray<SessionSummary>,
  running: boolean,
): TaskNode[] {
  const nodes: TaskNode[] = []
  let step = 0
  for (const message of messages) {
    if (message.type !== "assistant") continue
    step++
    const tokens = message.tokens
      ? message.tokens.input +
        message.tokens.output +
        message.tokens.reasoning +
        message.tokens.cache.read +
        message.tokens.cache.write
      : undefined
    nodes.push({
      id: `step:${message.id}`,
      kind: "step",
      title: `Step ${step}`,
      status: message.error ? "failed" : message.time.completed ? "done" : running ? "running" : "stalled",
      dependsOn: [],
      layer: 0,
      messageID: message.id,
      detail: [message.agent, message.model.id, message.finish].filter(Boolean).join(" · "),
      started: message.time.created,
      completed: message.time.completed,
      tokens,
      cost: message.cost,
    })
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.name === "taskwrite" || part.name === "todowrite") continue
      const status =
        part.state.status === "error"
          ? "failed"
          : part.state.status === "completed"
            ? "done"
            : part.state.status === "running" || part.state.status === "streaming"
              ? "running"
              : "pending"
      nodes.push({
        id: `tool:${part.id}`,
        kind: "tool",
        title: part.name,
        status,
        dependsOn: [],
        layer: 1,
        messageID: message.id,
        detail: toolDetail(part.name, part.state),
        started: part.time.created,
        completed: part.time.completed,
      })
    }
  }
  for (const session of sessions) {
    nodes.push({
      id: `subagent:${session.id}`,
      kind: "subagent",
      title: `@${session.title ?? session.id}`,
      status: session.waiting ? "waiting" : session.status === "running" ? "running" : "done",
      dependsOn: [],
      layer: 0,
      sessionID: session.id,
      detail: session.title ? session.id : undefined,
    })
  }
  return nodes.slice(-120)
}

function toolDetail(name: string, state: SessionMessageAssistantTool["state"]) {
  if (state.status === "streaming") return state.input.slice(0, 80)
  const input = state.input
  const value =
    (typeof input.command === "string" && input.command) ||
    (typeof input.path === "string" && input.path) ||
    (typeof input.filePath === "string" && input.filePath) ||
    (typeof input.pattern === "string" && input.pattern) ||
    (typeof input.description === "string" && input.description) ||
    (typeof input.query === "string" && input.query)
  if (value) return value.length > 80 ? `${value.slice(0, 79)}…` : value
  return name
}

function taskLayers(tasks: ReadonlyArray<TaskGraph.Task>) {
  const byID = new Map(tasks.map((task) => [task.id, task]))
  const cache = new Map<string, number>()
  const visiting = new Set<string>()
  const layer = (id: string): number => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const task = byID.get(id)
    const next = task && task.dependsOn.length > 0 ? 1 + Math.max(...task.dependsOn.map(layer)) : 0
    visiting.delete(id)
    cache.set(id, next)
    return next
  }
  return new Map(tasks.map((task) => [task.id, layer(task.id)]))
}

function dependentsOf(tasks: ReadonlyArray<TaskGraph.Task>) {
  const result: Record<string, string[]> = {}
  for (const task of tasks) {
    for (const dependency of task.dependsOn) (result[dependency] ??= []).push(task.id)
  }
  return result
}

function byLayerThenStatus(a: TaskNode, b: TaskNode) {
  return a.layer - b.layer || statusRank(a.status) - statusRank(b.status) || a.title.localeCompare(b.title)
}

function statusRank(status: TaskNodeStatus) {
  if (status === "running") return 0
  if (status === "waiting" || status === "blocked" || status === "stalled") return 1
  if (status === "ready") return 2
  if (status === "pending") return 3
  if (status === "done") return 4
  if (status === "skipped") return 5
  if (status === "cancelled") return 6
  return 7
}
