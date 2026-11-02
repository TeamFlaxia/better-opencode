import type { LocationRef } from "@opencode/client"
import { execFile } from "node:child_process"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { detectVcsKind, resolveVcsTool, summarizeJj, type VcsKind, type VcsSummary } from "../util/vcs"
import { errorMessage } from "../util/error"
import { useToast } from "../ui/toast"
import { useClient } from "./client"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useLocation } from "./location"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"
import { useSessionTerminals } from "./session-terminals"

const JJ_LOG_TEMPLATE =
  'change_id.short() ++ "\\t" ++ bookmarks.join(" ") ++ "\\t" ++ description.first_line() ++ "\\t" ++ empty ++ "\\t" ++ conflict'

function run(command: string, args: string[], cwd: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", JJ_PAGER: "cat" },
      },
      (error, stdout, stderr) => {
        if (error) return reject(error)
        resolve({ stdout, stderr })
      },
    )
  })
}

export const { use: useVcs, provider: VcsProvider } = createSimpleContext({
  name: "Vcs",
  init: () => {
    const config = useConfig()
    const client = useClient()
    const data = useData()
    const route = useRoute()
    const location = useLocation()
    const sessionTabs = useSessionTabs()
    const sessions = useSessionTerminals()
    const toast = useToast()
    const enabled = () => config.data.experimental?.["vcs-dock"] === true
    const [summary, setSummary] = createSignal<VcsSummary>()
    const [refreshing, setRefreshing] = createSignal(false)
    const sessionID = createMemo(() => {
      if (route.data.type === "session") return route.data.sessionID
      return sessionTabs.current()
    })
    const ref = createMemo<LocationRef | undefined>(() => {
      const id = sessionID()
      const session = id ? data.session.get(id) : undefined
      if (session) return session.location
      return location.ref ?? data.location.default()
    })
    const info = createMemo(() => {
      const target = ref()
      return target ? data.location.info(target) : undefined
    })
    const canonical = createMemo(() => info()?.project.canonical)
    const visible = () => enabled() && summary() !== undefined && summary()?.kind !== "none"
    const tool = createMemo(() => {
      const current = summary()
      if (!current) return
      return resolveVcsTool(current.kind, config.data.vcs.tool)
    })
    let generation = 0
    let running = false

    const refresh = async () => {
      if (!enabled() || running) return
      const target = ref()
      const current = info()
      if (!target || !current) return
      running = true
      const attempt = ++generation
      setRefreshing(true)
      try {
        const kind = detectVcsKind(current.project.canonical)
        const next = kind === "jj" ? await collectJj(current.directory) : await collectApi(kind, target)
        if (attempt === generation) setSummary(next)
      } catch {
        // Keep the last summary on transient jj or transport failures.
      } finally {
        running = false
        if (attempt === generation) setRefreshing(false)
      }
    }

    const collectApi = async (kind: VcsKind, target: LocationRef): Promise<VcsSummary> => {
      if (kind === "none") return { kind, label: "no repository", detail: "", dirty: 0, conflict: false }
      const [info, status] = await Promise.all([
        client.api.vcs.get({ location: target }).then(
          (result) => result.data,
          () => undefined,
        ),
        client.api.vcs.status({ location: target }).then(
          (result) => result.data,
          () => [],
        ),
      ])
      const dirty = status.length
      return {
        kind,
        label: info?.branch.current ?? "detached",
        detail: dirty === 0 ? "clean" : `${dirty} changed file${dirty === 1 ? "" : "s"}`,
        dirty,
        conflict: false,
      }
    }

    const collectJj = async (directory: string): Promise<VcsSummary> => {
      const [log, diff] = await Promise.all([
        run("jj", ["--no-pager", "--color=never", "log", "--no-graph", "-r", "@", "-T", JJ_LOG_TEMPLATE], directory),
        run("jj", ["--no-pager", "--color=never", "diff", "--summary"], directory),
      ])
      return summarizeJj(log.stdout, diff.stdout)
    }

    const openTool = async () => {
      const current = summary()
      const id = sessionID()
      if (!current || current.kind === "none") return
      if (!id) {
        toast.show({ variant: "warning", message: "Open a session to launch a version control tool." })
        return
      }
      const selected = resolveVcsTool(current.kind, config.data.vcs.tool)
      if (!selected) {
        const suggestion =
          current.kind === "jj" ? "lazyjj or jjui" : current.kind === "git" ? "lazygit" : undefined
        toast.show({
          variant: "warning",
          title: "Version control tool not found",
          message: suggestion
            ? `Install ${suggestion} or set vcs.tool in your TUI config.`
            : "Set vcs.tool in your TUI config to an installed version control TUI.",
        })
        return
      }
      try {
        const existing = sessions
          .get(id)
          .terminals.find((terminal) => terminal.title === selected.label && terminal.status === "running")
        if (existing) {
          await sessions.selectTerminal(id, existing.id)
          return
        }
        await sessions.newTerminal(id, {
          command: selected.command,
          title: selected.label,
          cwd: info()?.directory,
          focus: true,
        })
      } catch (error) {
        toast.show({
          variant: "error",
          title: `Failed to open ${selected.label}`,
          message: errorMessage(error),
        })
      }
    }

    createEffect(() => {
      if (!enabled()) {
        setSummary(undefined)
        return
      }
      if (!canonical()) {
        setSummary(undefined)
        return
      }
      setSummary(undefined)
      let disposed = false
      void refresh()
      const interval = setInterval(() => {
        if (!disposed) void refresh()
      }, config.data.vcs.refresh_interval)
      onCleanup(() => {
        disposed = true
        clearInterval(interval)
      })
    })

    return {
      visible,
      summary,
      refreshing,
      tool,
      refresh,
      openTool,
    }
  },
})
