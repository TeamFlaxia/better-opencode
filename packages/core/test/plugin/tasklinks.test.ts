import { describe, expect } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import { TaskLinkPlugin } from "@opencode/core/plugin/tasklinks"
import { TaskLink } from "@opencode/schema/task-link"
import { it } from "../lib/effect"
import { host } from "./host"

const sessionID = "ses_tasklinks"

type Handlers = {
  get?: (input: { sessionID: string }) => Effect.Effect<TaskLink.State | null>
  set?: (input: { sessionID: string; taskID: string; link: TaskLink.Link }) => Effect.Effect<TaskLink.State>
  remove?: (input: { sessionID: string; taskID: string }) => Effect.Effect<TaskLink.State>
}

const run = Effect.fnUntraced(function* () {
  const stored = new Map<string, Schema.Json>()
  const handlers: Handlers = {}
  const changed: unknown[] = []
  const events = yield* Queue.unbounded<{ type: string; data: { sessionID: string } }>()
  yield* TaskLinkPlugin.Plugin.effect(
    host({
      storage: {
        get: (key) => Effect.sync(() => stored.get(key)),
        set: (key, value) => Effect.sync(() => void stored.set(key, value)),
        remove: (key) => Effect.sync(() => void stored.delete(key)),
        scan: () => Effect.succeed({ entries: [] }),
      },
      rpc: Object.assign(
        () => {
          throw new Error("unused rpc.client")
        },
        {
          register: ((_definition: unknown, registered: Handlers) =>
            Effect.sync(() => {
              Object.assign(handlers, registered)
              return {
                dispose: Effect.void,
                events: { emit: (_name: string, data: unknown) => Effect.sync(() => void changed.push(data)) },
              }
            })) as never,
        },
      ),
      // SAFETY: the plugin filters this stream down to session.deleted events.
      event: { subscribe: () => Stream.fromQueue(events) as never },
    }),
  )
  yield* Effect.yieldNow
  return {
    get: (id = sessionID) => handlers.get?.({ sessionID: id }) ?? Effect.die("get was not registered"),
    set: (taskID: string, link: TaskLink.Link) =>
      handlers.set?.({ sessionID, taskID, link }) ?? Effect.die("set was not registered"),
    remove: (taskID: string) => handlers.remove?.({ sessionID, taskID }) ?? Effect.die("remove was not registered"),
    emit: (type: string) => Queue.offer(events, { type, data: { sessionID } }).pipe(Effect.andThen(Effect.yieldNow)),
    stored,
    changed,
  }
})

describe("TaskLinkPlugin", () => {
  it.effect("stores, publishes, and removes task links", () =>
    Effect.gen(function* () {
      const links = yield* run()
      const link: TaskLink.Link = { change: "znnsty", bookmark: "task/build", updatedAt: 10 }

      expect(yield* links.get()).toBeNull()
      expect(yield* links.set("build", link)).toEqual({ links: { build: link } })
      expect(links.stored.get(`session:${sessionID}`)).toEqual({ links: { build: link } })
      expect(links.changed).toEqual([{ sessionID, state: { links: { build: link } } }])
      expect(yield* links.get()).toEqual({ links: { build: link } })

      expect(yield* links.remove("build")).toEqual({ links: {} })
      expect(links.stored.has(`session:${sessionID}`)).toBe(false)
    }),
  )

  it.effect("drops links when the session is deleted", () =>
    Effect.gen(function* () {
      const links = yield* run()
      yield* links.set("build", { change: "znnsty", updatedAt: 10 })
      yield* links.emit("session.deleted")
      expect(links.stored.has(`session:${sessionID}`)).toBe(false)
    }),
  )
})
