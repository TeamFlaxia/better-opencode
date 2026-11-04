import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { TaskWriteTool } from "@opencode/core/tool/plugin/taskgraph"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_task_graph_tool_test")
const enabled = new ConfigExperimental.Info({ "task-graph": true })
const tasks = [
  { id: "design", title: "Design", status: "done", dependsOn: [] },
  { id: "build", title: "Build", status: "active", dependsOn: ["design"] },
] as const

const it = testEffect(
  AppNodeBuilder.build(Tool.node, [Image.node.replace(imagePassthrough), Permission.node.replace(permissionLayer())]),
)

const setup = (experimental: ConfigExperimental.Info | undefined) =>
  Effect.gen(function* () {
    yield* registerToolPlugin(TaskWriteTool.Plugin, { event: { subscribe: () => Stream.never } }).pipe(
      Effect.provide(Layer.mock(Config.Service)({ entries: () => Effect.succeed([document(experimental)]) })),
      Effect.provide(permissionLayer({ assert: () => Effect.void })),
    )
    return yield* Tool.Service
  })

const names = (registry: Tool.Interface) =>
  toolDefinitions(registry).pipe(Effect.map((definitions) => definitions.map((definition) => definition.name)))

describe("TaskWriteTool", () => {
  it.effect("is absent unless experimental.task-graph is enabled", () =>
    Effect.gen(function* () {
      expect(yield* names(yield* setup(undefined))).not.toContain(TaskWriteTool.name)
      expect(yield* names(yield* setup(new ConfigExperimental.Info({ "task-graph": false })))).not.toContain(
        TaskWriteTool.name,
      )
    }),
  )

  it.effect("registers taskwrite and summarizes the graph", () =>
    Effect.gen(function* () {
      const registry = yield* setup(enabled)
      const definition = (yield* toolDefinitions(registry)).find((tool) => tool.name === TaskWriteTool.name)

      expect(definition?.inputSchema).toHaveProperty("properties.tasks.type", "array")
      expect(definition?.inputSchema).toHaveProperty("properties.tasks.items.required", [
        "id",
        "title",
        "status",
        "dependsOn",
      ])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-taskwrite", name: TaskWriteTool.name, input: { tasks } },
        }),
      ).toEqual({
        status: "completed",
        output: { tasks },
        content: [
          {
            type: "text",
            text: 'Task graph updated: 1/2 done, 1 active. Active: "Build"',
          },
        ],
        metadata: { tasks },
      })
    }),
  )

  it.effect("rejects dependencies that are not in the graph", () =>
    Effect.gen(function* () {
      const registry = yield* setup(enabled)
      const result = yield* executeTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-taskwrite-invalid",
          name: TaskWriteTool.name,
          input: { tasks: [{ id: "a", title: "A", status: "pending", dependsOn: ["missing"] }] },
        },
      })

      expect(result).toMatchObject({
        status: "error",
        error: { message: 'Task "a" depends on unknown task "missing".' },
      })
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}
