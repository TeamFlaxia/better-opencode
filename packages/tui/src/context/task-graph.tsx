import { Goal } from "@opencode/schema/goal"
import { TaskGraph } from "@opencode/schema/task-graph"
import { TaskLink } from "@opencode/schema/task-link"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { useConfig } from "../config"
import {
  buildTaskGraph,
  taskGraphDeclaredAt,
  type SessionSummary,
  type TaskGraphModel,
} from "../util/task-graph"
import type { VcsLinkInfo, VcsLinkRef } from "../util/vcs"
import { useClient } from "./client"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"
import { useVcs } from "./vcs"

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
  readonly links: () => Readonly<Record<string, TaskLink.Link>>
  readonly setLink: (taskID: string, link: TaskLink.Link) => Promise<void>
  readonly removeLink: (taskID: string) => Promise<void>
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
    const vcs = useVcs()
    const rpc = client.api.rpc(Goal.Definition)
    const linkRpc = client.api.rpc(TaskLink.Definition)
    const [goal, setGoal] = createSignal<Goal.State>()
    const [links, setLinks] = createSignal<Record<string, TaskLink.Link>>({})
    const [vcsLinks, setVcsLinks] = createSignal<Record<string, VcsLinkInfo>>({})
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
    let linkTurn = 0
    const loadLinks = (id: string) => {
      const current = ++linkTurn
      const directory = data.session.get(id)?.location.directory
      // A server without the tasklinks plugin answers with an error; links stay empty.
      void linkRpc.get({ sessionID: id }, directory ? { location: { directory } } : undefined).then(
        (next) => {
          if (current === linkTurn && sessionID() === id) setLinks(next?.links ?? {})
        },
        () => undefined,
      )
    }
    onCleanup(
      linkRpc.events.on("changed", (event) => {
        if (event.data.sessionID !== sessionID()) return
        linkTurn++
        setLinks(event.data.state.links)
      }),
    )
    onCleanup(
      data.on("server.connected", () => {
        const id = sessionID()
        if (id) loadLinks(id)
      }),
    )
    createEffect(
      on(sessionID, (id) => {
        setGoal(undefined)
        setLinks({})
        setVcsLinks({})
        if (id) {
          load(id)
          loadLinks(id)
        }
      }),
    )

    const declared = createMemo(() => {
      const id = sessionID()
      return id ? TaskGraph.latest(data.session.message.list(id)) : []
    })
    const refs = createMemo<VcsLinkRef[]>(() =>
      declared().flatMap((task) => {
        const stored = links()[task.id]
        const bookmark = stored?.bookmark ?? task.bookmark ?? (stored?.change || task.change ? undefined : `task/${task.id}`)
        const change = stored?.change ?? task.change
        return bookmark || change ? [{ key: task.id, bookmark, change }] : []
      }),
    )
    const head = createMemo(() => vcs.summary()?.change)
    createEffect(() => {
      const current = refs()
      if (!enabled() || current.length === 0) {
        setVcsLinks({})
        return
      }
      let cancelled = false
      onCleanup(() => (cancelled = true))
      void vcs.resolveLinks(current).then((next) => {
        if (!cancelled) setVcsLinks(next)
      })
    })

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
      const messages = data.session.message.list(id)
      return buildTaskGraph({
        messages,
        goal: goal(),
        sessions: sessions(),
        running: data.session.status(id) === "running",
        waiting: waiting(),
        links: links(),
        vcsLinks: vcsLinks(),
        vcsHead: head(),
        declaredAt: taskGraphDeclaredAt(messages),
      })
    })
    // The dock is resident while the experiment is enabled, including before the session
    // declares tasks, so it stays a stable entry point to the graph.
    const visible = () => enabled()

    const refresh = async () => {
      if (!enabled()) return
      const id = sessionID()
      if (!id) return
      load(id)
      loadLinks(id)
      await Promise.all([
        data.session.sync(id, { children: true }).catch(() => undefined),
        data.session.message.sync(id).catch(() => undefined),
      ])
      const current = refs()
      if (current.length > 0) setVcsLinks(await vcs.resolveLinks(current))
    }

    const linkOptions = (id: string) => {
      const directory = data.session.get(id)?.location.directory
      return directory ? { location: { directory } } : undefined
    }
    const setLink = async (taskID: string, link: TaskLink.Link) => {
      const id = sessionID()
      if (!id) return
      const next = await linkRpc.set({ sessionID: id, taskID, link }, linkOptions(id)).catch(() => undefined)
      if (next && sessionID() === id) setLinks(next.links)
    }
    const removeLink = async (taskID: string) => {
      const id = sessionID()
      if (!id) return
      const next = await linkRpc.remove({ sessionID: id, taskID }, linkOptions(id)).catch(() => undefined)
      if (next && sessionID() === id) setLinks(next.links)
    }

    return {
      enabled,
      visible,
      sessionID,
      goal,
      graph,
      links,
      setLink,
      removeLink,
      refresh,
    }
  },
})
