import { Goal } from "@opencode/schema/goal"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { buildTaskGraph, type SessionSummary, type TaskGraphModel } from "../util/task-graph"
import { useClient } from "./client"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"

/**
 * The Task graph view is derived from the session's durable messages plus the goal plugin's state. The declared graph
 * comes from the latest `taskwrite` call, so it needs no second source of truth and updates with the transcript.
 */
export type TaskGraphController = {
  readonly enabled: () => boolean
  readonly visible: () => boolean
  readonly sessionID: () => string | undefined
  readonly goal: () => Goal.State | undefined
  readonly graph: () => TaskGraphModel
  readonly refresh: () => Promise<void>
}

export const { use: useTaskGraph, provider: TaskGraphProvider } = createSimpleContext({
  name: "TaskGraph",
  init: () => {
    const config = useConfig()
    const client = useClient()
    const data = useData()
    const route = useRoute()
    const sessionTabs = useSessionTabs()
    const rpc = client.api.rpc(Goal.Definition)
    const [goal, setGoal] = createSignal<Goal.State>()
    const enabled = () => config.data.experimental?.["task-graph"] === true
    const sessionID = createMemo(() => {
      if (route.data.type === "session") return route.data.sessionID
      return sessionTabs.current()
    })

    // A change that arrives while a fetch is in flight is newer than its reply, so each change or fetch takes a turn.
    let turn = 0
    const load = (id: string) => {
      const current = ++turn
      const directory = data.session.get(id)?.location.directory
      // A server without the goal plugin answers with an error, and the view shows no goal.
      void rpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
        (next) => {
          if (current === turn && sessionID() === id) setGoal(next ?? undefined)
        },
        () => undefined,
      )
    }
    onCleanup(
      rpc.events.on("changed", (event) => {
        if (event.data.sessionID !== sessionID()) return
        turn++
        setGoal(event.data.goal ?? undefined)
      }),
    )
    onCleanup(
      data.on("server.connected", () => {
        const id = sessionID()
        if (id) load(id)
      }),
    )
    createEffect(
      on(sessionID, (id) => {
        setGoal(undefined)
        if (id) load(id)
      }),
    )

    const sessions = createMemo<SessionSummary[]>(() => {
      const id = sessionID()
      if (!id) return []
      return data.session
        .family(id)
        .filter((child) => child !== id && data.session.get(child)?.parentID === id)
        .map((child) => {
          const info = data.session.get(child)
          return {
            id: child,
            title: info?.title,
            parentID: info?.parentID,
            status: data.session.status(child) === "running" ? "running" : "idle",
            waiting:
              (data.session.permission.list(child)?.length ?? 0) > 0 ||
              (data.session.form.list(child)?.length ?? 0) > 0,
          }
        })
    })
    const waiting = createMemo(() => {
      const id = sessionID()
      if (!id) return false
      return (
        (data.session.permission.list(id)?.length ?? 0) > 0 ||
        (data.session.form.list(id)?.length ?? 0) > 0
      )
    })
    const graph = createMemo(() => {
      const id = sessionID()
      if (!id || !enabled()) return buildTaskGraph({ messages: [] })
      return buildTaskGraph({
        messages: data.session.message.list(id),
        goal: goal(),
        sessions: sessions(),
        running: data.session.status(id) === "running",
        waiting: waiting(),
      })
    })
    const visible = () =>
      enabled() &&
      (graph().goal !== undefined ||
        graph().tasks.length > 0 ||
        graph().execution.some((node) => node.status === "running" || node.status === "waiting"))

    const refresh = async () => {
      if (!enabled()) return
      const id = sessionID()
      if (!id) return
      load(id)
      await Promise.all([
        data.session.sync(id, { children: true }).catch(() => undefined),
        data.session.message.sync(id).catch(() => undefined),
      ])
    }

    return {
      enabled,
      visible,
      sessionID,
      goal,
      graph,
      refresh,
    }
  },
})
