export * as TaskLinkPlugin from "./tasklinks.js"

import { define } from "@opencode/plugin/effect/plugin"
import { TaskLink } from "@opencode/schema/task-link"
import { Effect, Option, Schema, Stream } from "effect"

const PREFIX = "session:"
const decodeState = Schema.decodeUnknownOption(TaskLink.State)

/**
 * Stores bindings a TUI action creates between declared tasks and jj changes, bookmarks, workspaces, or sessions.
 * Declared task state remains in the session transcript, so this store never becomes a second task graph.
 */
export const Plugin = define({
  id: "opencode.tasklinks",
  effect: Effect.fn(function* (ctx) {
    const read = Effect.fn("TaskLinkPlugin.read")(function* (sessionID: string) {
      return Option.getOrUndefined(decodeState(yield* ctx.storage.get(PREFIX + sessionID)))
    })

    // The handlers are created before the registration returns, so publish through a late-bound dispatcher.
    let dispatch: (sessionID: string, state: TaskLink.State) => Effect.Effect<void> = () => Effect.void
    const write = (sessionID: string, state: TaskLink.State) =>
      Effect.gen(function* () {
        if (Object.keys(state.links).length === 0) yield* ctx.storage.remove(PREFIX + sessionID)
        else yield* ctx.storage.set(PREFIX + sessionID, state)
        yield* dispatch(sessionID, state)
        return state
      })

    const rpc = yield* ctx.rpc
      .register(TaskLink.Definition, {
        get: (input) => read(input.sessionID).pipe(Effect.map((state) => state ?? null)),
        set: (input) =>
          Effect.gen(function* () {
            const previous = (yield* read(input.sessionID)) ?? { links: {} }
            return yield* write(input.sessionID, { links: { ...previous.links, [input.taskID]: input.link } })
          }),
        remove: (input) =>
          Effect.gen(function* () {
            const previous = (yield* read(input.sessionID)) ?? { links: {} }
            const links = { ...previous.links }
            delete links[input.taskID]
            return yield* write(input.sessionID, { links })
          }),
      })
      .pipe(Effect.orDie)

    dispatch = (sessionID, state) =>
      rpc.events
        .emit("changed", { sessionID, state })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to publish task links", { cause })))

    yield* ctx.event
      .subscribe({ types: ["session.deleted"] })
      .pipe(
        Stream.runForEach((event) =>
          ctx.storage
            .remove(PREFIX + event.data.sessionID)
            .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to remove task links", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})
