import type { LocationRef } from "@opencode/client"
import { execFile } from "node:child_process"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import {
  detectVcsKinds,
  mutationCommands,
  parseGitBranches,
  parseGitDiffHunks,
  parseGitHistory,
  parseGitStatus,
  parseJjBookmarks,
  parseJjHistory,
  resolveVcsTool,
  summarizeJj,
  type VcsBranchAction,
  type VcsHunkPatch,
  type VcsKind,
  type VcsListEntry,
  type VcsMutation,
  type VcsSummary,
} from "../util/vcs"
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
  'change_id.short() ++ "\\t" ++ bookmarks.join(" ") ++ "\\t" ++ description.first_line() ++ "\\t" ++ empty ++ "\\t" ++ conflict ++ "\\n"'
const JJ_BOOKMARK_TEMPLATE =
  'name ++ "\\t" ++ normal_target.change_id().short() ++ "\\t" ++ normal_target.commit_id().short() ++ "\\t" ++ normal_target.description().first_line() ++ "\\n"'
const JJ_HISTORY_TEMPLATE =
  'change_id.short() ++ "\\t" ++ commit_id.short() ++ "\\t" ++ bookmarks.join(" ") ++ "\\t" ++ description.first_line() ++ "\\n"'

function run(command: string, args: readonly string[], cwd: string, input?: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", JJ_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (error) return reject(error)
        resolve({ stdout, stderr })
      },
    )
    child.stdin?.end(input ?? "")
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
    const [summaries, setSummaries] = createSignal<readonly VcsSummary[]>([])
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
    const visible = () => enabled() && summaries().length > 0
    const summary = createMemo(() => summaries().at(0))
    const tool = (kind?: VcsKind) => {
      const current = kind ? summaries().find((item) => item.kind === kind) : summary()
      if (!current) return
      return resolveVcsTool(current.kind, config.data.vcs.tool)
    }
    let generation = 0
    let running = false
    let queued = false

    const refresh = async () => {
      if (!enabled()) return
      if (running) {
        queued = true
        return
      }
      const target = ref()
      const current = info()
      if (!target || !current) return
      running = true
      const attempt = ++generation
      setRefreshing(true)
      try {
        const kinds = detectVcsKinds(current.project.canonical)
        const next = (
          await Promise.all(
            kinds.map(async (kind) => {
              try {
                return kind === "jj"
                  ? await collectJj(current.project.canonical)
                  : kind === "git"
                    ? await collectGit(target, current.project.canonical)
                    : await collectApi(kind, target)
              } catch {
                return undefined
              }
            }),
          )
        ).filter((item): item is VcsSummary => item !== undefined)
        if (attempt === generation)
          setSummaries((previous) =>
            kinds.flatMap((kind) => {
              const nextSummary = next.find((item) => item.kind === kind)
              const previousSummary = previous.find((item) => item.kind === kind)
              const summary = nextSummary ?? previousSummary
              return summary ? [summary] : []
            }),
          )
      } finally {
        running = false
        if (attempt === generation) setRefreshing(false)
        if (queued) {
          queued = false
          void refresh()
        }
      }
    }

    const collectApi = async (kind: VcsKind, target: LocationRef): Promise<VcsSummary> => {
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
      const files = status.map((file) => ({
        file: file.file,
        status: file.status,
        staged: false,
        unstaged: true,
      }))
      const dirty = files.length
      return {
        kind,
        label: info?.branch.current ?? "detached",
        detail: dirty === 0 ? "clean" : `${dirty} changed file${dirty === 1 ? "" : "s"}`,
        dirty,
        conflict: false,
        files,
      }
    }

    const collectGit = async (target: LocationRef, directory: string): Promise<VcsSummary> => {
      const [info, status] = await Promise.all([
        client.api.vcs.get({ location: target }).then(
          (result) => result.data,
          () => undefined,
        ),
        run("git", ["status", "--porcelain=v1", "-z"], directory),
      ])
      const files = parseGitStatus(status.stdout)
      const dirty = files.length
      return {
        kind: "git",
        label: info?.branch.current ?? "detached",
        detail: dirty === 0 ? "clean" : `${dirty} changed file${dirty === 1 ? "" : "s"}`,
        dirty,
        conflict: files.some((file) => file.conflict),
        files,
      }
    }

    const collectJj = async (directory: string): Promise<VcsSummary> => {
      const [log, diff] = await Promise.all([
        run("jj", ["--no-pager", "--color=never", "log", "--no-graph", "-r", "@", "-T", JJ_LOG_TEMPLATE], directory),
        run("jj", ["--no-pager", "--color=never", "diff", "--summary"], directory),
      ])
      return summarizeJj(log.stdout, diff.stdout)
    }

    const launch = async (title: string, command: string, args: string[] = []) => {
      const id = sessionID()
      if (!id) {
        toast.show({ variant: "warning", message: "Open a session to launch a version control tool." })
        return
      }
      try {
        const existing = sessions
          .get(id)
          .terminals.find((terminal) => terminal.title === title && terminal.status === "running")
        if (existing) {
          await sessions.selectTerminal(id, existing.id)
          return
        }
        await sessions.newTerminal(id, {
          command,
          args,
          title,
          cwd: info()?.project.canonical,
          focus: true,
        })
      } catch (error) {
        toast.show({
          variant: "error",
          title: `Failed to open ${title}`,
          message: errorMessage(error),
        })
      }
    }

    const openTool = async (kind?: VcsKind) => {
      const current = kind ? summaries().find((item) => item.kind === kind) : summary()
      if (!current) return
      const selected = resolveVcsTool(current.kind, config.data.vcs.tool)
      if (!selected) {
        const suggestion = current.kind === "jj" ? "lazyjj or jjui" : current.kind === "git" ? "lazygit" : undefined
        toast.show({
          variant: "warning",
          title: "Version control tool not found",
          message: suggestion
            ? `Install ${suggestion} or set vcs.tool in your TUI config.`
            : "Set vcs.tool in your TUI config to an installed version control TUI.",
        })
        return
      }
      await launch(selected.label, selected.command)
    }

    const openCommand = async (title: string, command: string, args: string[]) => {
      await launch(title, command, args)
    }

    const execute = async (action: VcsMutation, input?: string, paths: readonly string[] = [], kind?: VcsKind) => {
      const current = kind ? summaries().find((item) => item.kind === kind) : summary()
      const target = info()
      if (!current || !target) return
      const commands = mutationCommands(current.kind, action, input, paths)
      if (commands.length === 0) return
      // Version control commands print root-relative paths, so they run from the repository root.
      const cwd = current.kind === "jj" || current.kind === "git" ? target.project.canonical : target.directory
      try {
        for (const command of commands) await run(command.command, command.args, cwd)
        await refresh()
        toast.show({ variant: "success", message: `Version control: ${action} completed` })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const patch = async (kind: VcsKind, file: string, staged: boolean) => {
      const target = info()
      if (!target) return ""
      if (kind === "git")
        return (await run("git", ["diff", ...(staged ? ["--cached"] : []), "--", file], target.project.canonical))
          .stdout
      if (kind === "jj")
        return (await run("jj", ["--no-pager", "--color=never", "diff", "--git", "--", file], target.project.canonical))
          .stdout
      return ""
    }

    const branches = async (kind: VcsKind): Promise<VcsListEntry[]> => {
      const target = info()
      if (!target) return []
      if (kind === "git") {
        const result = await run(
          "git",
          ["--no-pager", "branch", "--format=%(HEAD)%09%(refname:short)%09%(objectname:short)%09%(contents:subject)"],
          target.project.canonical,
        )
        return parseGitBranches(result.stdout)
      }
      if (kind === "jj") {
        const result = await run(
          "jj",
          ["--no-pager", "--color=never", "bookmark", "list", "-T", JJ_BOOKMARK_TEMPLATE],
          target.project.canonical,
        )
        return parseJjBookmarks(result.stdout, summaries().find((summary) => summary.kind === "jj")?.change)
      }
      return []
    }

    const history = async (kind: VcsKind): Promise<VcsListEntry[]> => {
      const target = info()
      if (!target) return []
      if (kind === "git") {
        const result = await run(
          "git",
          ["--no-pager", "log", "--date=short", "--pretty=format:%h%x09%ad%x09%an%x09%s", "-n", "50"],
          target.project.canonical,
        )
        return parseGitHistory(result.stdout)
      }
      if (kind === "jj") {
        const result = await run(
          "jj",
          ["--no-pager", "--color=never", "log", "--no-graph", "-r", "::@", "-n", "50", "-T", JJ_HISTORY_TEMPLATE],
          target.project.canonical,
        )
        return parseJjHistory(result.stdout)
      }
      return []
    }

    const show = async (kind: VcsKind, ref: string) => {
      const target = info()
      if (!target) return ""
      if (kind === "git")
        return (
          await run(
            "git",
            ["--no-pager", "show", "--color=never", "--format=medium", "--stat", "--patch", ref],
            target.project.canonical,
          )
        ).stdout
      if (kind === "jj")
        return (await run("jj", ["--no-pager", "--color=never", "show", "--git", "-r", ref], target.project.canonical))
          .stdout
      return ""
    }

    const switchTo = async (kind: VcsKind, ref: string) => {
      const target = info()
      if (!target) return
      try {
        if (kind === "git") await run("git", ["switch", ref], target.project.canonical)
        else if (kind === "jj") await run("jj", ["edit", ref], target.project.canonical)
        await refresh()
        toast.show({ variant: "success", message: `Version control: switched to ${ref}` })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const branchAction = async (
      kind: VcsKind,
      action: VcsBranchAction,
      input: { name?: string; previous?: string; target?: string },
    ) => {
      const target = info()
      if (!target) return
      try {
        if (kind === "git") {
          if (action === "create" && input.name) {
            await run(
              "git",
              input.target ? ["branch", input.name, input.target] : ["switch", "-c", input.name],
              target.project.canonical,
            )
          }
          if (action === "delete" && input.previous)
            await run("git", ["branch", "-d", input.previous], target.project.canonical)
          if (action === "rename" && input.previous && input.name)
            await run("git", ["branch", "-m", input.previous, input.name], target.project.canonical)
        } else if (kind === "jj") {
          if (action === "create" && input.name)
            await run("jj", ["bookmark", "set", input.name, "-r", input.target ?? "@"], target.project.canonical)
          if (action === "delete" && input.previous)
            await run("jj", ["bookmark", "delete", input.previous], target.project.canonical)
          if (action === "rename" && input.previous && input.name)
            await run("jj", ["bookmark", "rename", input.previous, input.name], target.project.canonical)
        }
        await refresh()
        toast.show({ variant: "success", message: `Version control: ${action} completed` })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const hunks = async (file: string, cached: boolean): Promise<VcsHunkPatch> => {
      const target = info()
      if (!target) return { header: "", hunks: [] }
      const result = await run("git", ["diff", ...(cached ? ["--cached"] : []), "--", file], target.project.canonical)
      return parseGitDiffHunks(result.stdout)
    }

    const applyHunks = async (patch: string, reverse: boolean) => {
      const target = info()
      if (!target) return
      try {
        await run("git", ["apply", "--cached", ...(reverse ? ["-R"] : [])], target.project.canonical, patch)
        await refresh()
        toast.show({ variant: "success", message: reverse ? "Hunks unstaged" : "Hunks staged" })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Hunk operation failed",
          message: errorMessage(error),
        })
      }
    }

    createEffect(() => {
      if (!enabled()) {
        setSummaries([])
        return
      }
      if (!canonical()) {
        setSummaries([])
        return
      }
      setSummaries([])
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
      summaries,
      summary,
      refreshing,
      tool,
      refresh,
      openTool,
      openCommand,
      execute,
      patch,
      branches,
      history,
      show,
      switchTo,
      branchAction,
      hunks,
      applyHunks,
    }
  },
})
