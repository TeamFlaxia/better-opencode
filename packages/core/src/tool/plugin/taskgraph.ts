export * as TaskWriteTool from "./taskgraph.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { TaskGraph } from "@opencode/schema/task-graph"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Permission } from "../../permission.js"
import DESCRIPTION from "../taskwrite.txt"

export const name = "taskwrite"

export const Plugin = {
  id: "opencode.tool.taskwrite",
  effect: Effect.fn("TaskWriteTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const enabled = () => Config.latest(loaded.entries, "experimental")?.["task-graph"] === true

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name,
          options: { codemode: false },
          description: DESCRIPTION,
          input: TaskGraph.Input,
          output: TaskGraph.Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Unable to update the task graph", error })),
                Effect.flatMap(() => {
                  const issue = TaskGraph.issues(input.tasks)
                  if (issue) return Effect.fail(new ToolFailure({ message: issue }))
                  return Effect.succeed({
                    output: { tasks: input.tasks },
                    content: TaskGraph.summarize(input.tasks),
                    metadata: { tasks: input.tasks },
                  })
                }),
              ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
