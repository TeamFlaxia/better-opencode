export * as TaskGraph from "./task-graph.js"

import { Option, Schema } from "effect"
import { optional } from "./schema.js"

/** The declared part of a Session's task graph. Execution nodes are derived by clients from messages and events. */
export const MAX_TASKS = 50

export const Status = Schema.Literals(["pending", "active", "done", "blocked", "cancelled"])
export type Status = typeof Status.Type

const Label = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()))
const Bookmark = Schema.Trim.pipe(
  Schema.check(Schema.isNonEmpty()),
  Schema.check(Schema.isPattern(/^[^\s\x00-\x1f\x7f]+$/u)),
)

export interface Task extends Schema.Schema.Type<typeof Task> {}
export const Task = Schema.Struct({
  id: Label.annotate({ description: "Stable identifier, unique within the graph" }),
  title: Label.annotate({ description: "One line describing the work" }),
  status: Status.annotate({ description: "pending, active, done, blocked, or cancelled" }),
  dependsOn: Schema.Array(Label).annotate({
    description: "Task IDs that must finish before this task can start",
  }),
  bookmark: Bookmark.pipe(optional).annotate({
    description: "The jj bookmark linked to this task, for example task/build",
  }),
  change: Label.pipe(optional).annotate({
    description: "The jj change ID linked to this task",
  }),
  reason: Label.pipe(optional).annotate({
    description: "Why the task is blocked, cancelled, or skipped",
  }),
}).annotate({ identifier: "TaskGraph.Task" })

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  tasks: Schema.Array(Task).annotate({ description: "The complete updated task graph" }),
}).annotate({ identifier: "TaskGraph.Input" })

export interface Output extends Schema.Schema.Type<typeof Output> {}
export const Output = Schema.Struct({
  tasks: Schema.Array(Task),
}).annotate({ identifier: "TaskGraph.Output" })

const decodeTasks = Schema.decodeUnknownOption(Schema.Array(Task))

/** Reads the tasks from an untrusted tool input or persisted message. */
export function parse(value: unknown): Task[] {
  const decoded = Array.isArray(value)
    ? Option.getOrUndefined(decodeTasks(value))
    : typeof value === "object" && value !== null && "tasks" in value
      ? Option.getOrUndefined(decodeTasks((value as { tasks?: unknown }).tasks))
      : undefined
  return decoded ? [...decoded] : []
}

/** The subset of a message that can declare a graph. Clients pass their own message projection. */
export type MessageLike = {
  readonly type: string
  readonly content?: ReadonlyArray<{
    readonly type: string
    readonly name?: string
    readonly state?: { readonly status: string; readonly input?: unknown }
  }>
}

/**
 * The current graph is the input of the latest completed `taskwrite` call. A Session's graph is its own, so children
 * and forks start without one.
 */
export function latest(messages: ReadonlyArray<MessageLike>): Task[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type !== "assistant" || !message.content) continue
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
      const part = message.content[partIndex]
      if (part?.type !== "tool" || part.name !== "taskwrite" || part.state?.status !== "completed") continue
      return parse(part.state.input)
    }
  }
  return []
}

/** A short graph description for the tool result and the goal continuation prompt. */
export function summarize(tasks: ReadonlyArray<Task>) {
  if (tasks.length === 0) return "Task graph cleared"
  const count = (status: Status) => tasks.filter((task) => task.status === status).length
  const counts = [
    `${count("done")}/${tasks.length} done`,
    ...(["active", "blocked", "pending", "cancelled"] as const).flatMap((status) =>
      count(status) ? [`${count(status)} ${status}`] : [],
    ),
  ].join(", ")
  const active = tasks.filter((task) => task.status === "active").map((task) => JSON.stringify(task.title))
  const blocked = tasks.filter((task) => task.status === "blocked").map((task) => JSON.stringify(task.title))
  return [
    `Task graph updated: ${counts}`,
    active.length ? `Active: ${active.join(", ")}` : undefined,
    blocked.length ? `Blocked: ${blocked.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join(". ")
}

/** Returns a user-facing error when the declared graph is malformed, duplicate, or cyclic. */
export function issues(tasks: ReadonlyArray<Task>): string | undefined {
  if (tasks.length > MAX_TASKS) return `A task graph is limited to ${MAX_TASKS} tasks (got ${tasks.length}).`
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) return `Task IDs must be unique: "${task.id}" appears more than once.`
    ids.add(task.id)
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) return `Task "${task.id}" cannot depend on itself.`
      if (!ids.has(dependency)) return `Task "${task.id}" depends on unknown task "${dependency}".`
    }
  }
  const cyclic = tasks.find((task) => reaches(tasks, task.id, new Set()))
  if (cyclic) return `Task dependencies contain a cycle through "${cyclic.id}".`
  return undefined
}

function reaches(tasks: ReadonlyArray<Task>, id: string, seen: Set<string>): boolean {
  if (seen.has(id)) return true
  seen.add(id)
  const task = tasks.find((item) => item.id === id)
  if (!task) return false
  return task.dependsOn.some((dependency) => reaches(tasks, dependency, new Set(seen)))
}
