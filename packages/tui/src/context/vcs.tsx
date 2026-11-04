import type { LocationRef } from "@opencode/client"
import { execFile } from "node:child_process"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useConfig } from "../config"
import {
  detectVcsKind,
  jjLinkRevset,
  JJ_LINK_TEMPLATE,
  matchJjLinks,
  mutationCommands,
  parseGitBranches,
  parseJjLinks,
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
  type VcsLinkInfo,
  type VcsLinkRef,
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
  'change_id.short() ++ "\\t" ++ commit_id.short() ++ "\\t" ++ bookmarks.join(" ") ++ "\\t" ++ description.first_line() ++ "\\t" ++ empty ++ "\\t" ++ conflict ++ "\\n"'
const JJ_BOOKMARK_TEMPLATE =
  'name ++ if(remote, "@" ++ remote, "") ++ "\\t" ++ normal_target.change_id().short() ++ "\\t" ++ normal_target.commit_id().short() ++ "\\t" ++ normal_target.description().first_line() ++ "\\t" ++ remote ++ "\\t" ++ normal_target.immutable() ++ "\\t" ++ tracked ++ "\\n"'
const JJ_HISTORY_TEMPLATE =
  'change_id.short() ++ "\\t" ++ commit_id.short() ++ "\\t" ++ bookmarks.join(" ") ++ "\\t" ++ description.first_line() ++ "\\t" ++ immutable ++ "\\n"'

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
    const [summary, setSummary] = createSignal<VcsSummary>()
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
    const visible = () => enabled() && summary() !== undefined
    const tool = createMemo(() => {
      const current = summary()
      if (!current) return
      return resolveVcsTool(current.kind, config.data.vcs.tool)
    })
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
      try {
        // jj owns its colocated Git repository, so render only the preferred kind instead of
        // listing the same files, bookmarks, and history twice.
        const kind = detectVcsKind(current.project.canonical)
        if (kind === "none") {
          if (attempt === generation) setSummary(undefined)
          return
        }
        const next = await (kind === "jj"
          ? collectJj(current.project.canonical)
          : kind === "git"
            ? collectGit(target, current.project.canonical)
            : collectApi(kind, target)
        ).catch(() => undefined)
        if (attempt === generation) setSummary((previous) => next ?? previous)
      } finally {
        running = false
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

    const openTool = async () => {
      const current = summary()
      if (!current) return
      const selected = tool()
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

    const execute = async (
      action: VcsMutation,
      input?: string,
      paths: readonly string[] = [],
      remote?: string,
    ) => {
      const current = summary()
      const target = info()
      if (!current || !target) return
      const commands = mutationCommands(current.kind, action, input, paths, remote)
      if (commands.length === 0) return
      // Version control commands print root-relative paths, so they run from the repository root.
      const cwd = current.kind === "jj" || current.kind === "git" ? target.project.canonical : target.directory
      try {
        for (const command of commands) await run(command.command, command.args, cwd)
        await refresh()
        toast.show({
          variant: "success",
          message:
            action === "push" && input
              ? `Version control: pushed ${input}${remote ? ` to ${remote}` : ""}`
              : `Version control: ${action} completed`,
        })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const patch = async (file: string, staged: boolean) => {
      const current = summary()
      const target = info()
      if (!current || !target) return ""
      const kind = current.kind
      if (kind === "git")
        return (await run("git", ["diff", ...(staged ? ["--cached"] : []), "--", file], target.project.canonical))
          .stdout
      if (kind === "jj")
        return (await run("jj", ["--no-pager", "--color=never", "diff", "--git", "--", file], target.project.canonical))
          .stdout
      return ""
    }

    const branches = async (): Promise<VcsListEntry[]> => {
      const current = summary()
      const target = info()
      if (!current || !target) return []
      const kind = current.kind
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
          ["--no-pager", "--color=never", "bookmark", "list", "--all-remotes", "-T", JJ_BOOKMARK_TEMPLATE],
          target.project.canonical,
        )
        return parseJjBookmarks(result.stdout, current.change)
      }
      return []
    }

    const remotes = async (): Promise<string[]> => {
      const current = summary()
      const target = info()
      if (!current || !target) return []
      try {
        const result =
          current.kind === "jj"
            ? await run("jj", ["--no-pager", "--color=never", "git", "remote", "list"], target.project.canonical)
            : current.kind === "git"
              ? await run("git", ["remote"], target.project.canonical)
              : undefined
        if (!result) return []
        return result.stdout
          .split("\n")
          .map((line) => line.trim().split(/\s+/)[0])
          .filter((name): name is string => Boolean(name))
      } catch {
        return []
      }
    }

    const history = async (): Promise<VcsListEntry[]> => {
      const current = summary()
      const target = info()
      if (!current || !target) return []
      const kind = current.kind
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

    const show = async (ref: string) => {
      const current = summary()
      const target = info()
      if (!current || !target) return ""
      const kind = current.kind
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

    const switchTo = async (ref: string) => {
      const current = summary()
      const target = info()
      if (!current || !target) return
      const kind = current.kind
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

    const startChange = async (ref: string) => {
      const current = summary()
      const target = info()
      if (!current || current.kind !== "jj" || !target) return
      try {
        await run("jj", ["new", ref], target.project.canonical)
        await refresh()
        toast.show({ variant: "success", message: `Version control: started a change from ${ref}` })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const moveBookmark = async (name: string, target: string) => {
      const current = summary()
      const targetLocation = info()
      if (!current || current.kind !== "jj" || !targetLocation) return
      try {
        await run("jj", ["bookmark", "move", name, "--to", target], targetLocation.project.canonical)
        await refresh()
        toast.show({ variant: "success", message: `Version control: moved ${name} to ${target}` })
      } catch (error) {
        toast.show({
          variant: "error",
          title: "Version control action failed",
          message: errorMessage(error),
        })
      }
    }

    const branchAction = async (
      action: VcsBranchAction,
      input: { name?: string; previous?: string; target?: string },
    ) => {
      const current = summary()
      const target = info()
      if (!current || !target) return
      const kind = current.kind
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

    const jjRepository = () => {
      const current = summary()
      const target = info()
      if (!current || current.kind !== "jj" || !target) return
      return { cwd: target.project.canonical }
    }

    const resolveLinks = async (refs: ReadonlyArray<VcsLinkRef>): Promise<Record<string, VcsLinkInfo>> => {
      const repository = jjRepository()
      if (!repository || refs.length === 0) return {}
      const revset = jjLinkRevset(refs)
      if (!revset) return {}
      try {
        const result = await run(
          "jj",
          ["--no-pager", "--color=never", "log", "--no-graph", "-r", revset, "-T", JJ_LINK_TEMPLATE],
          repository.cwd,
        )
        return matchJjLinks(refs, parseJjLinks(result.stdout))
      } catch {
        // One malformed change ID must not hide every other link. Retry each reference on its own.
        const result: Record<string, VcsLinkInfo> = {}
        for (const ref of refs) {
          const single = jjLinkRevset([ref])
          if (!single) continue
          try {
            const output = await run(
              "jj",
              ["--no-pager", "--color=never", "log", "--no-graph", "-r", single, "-T", JJ_LINK_TEMPLATE],
              repository.cwd,
            )
            Object.assign(result, matchJjLinks([ref], parseJjLinks(output.stdout)))
          } catch {
            // A task with a broken reference stays unlinked.
          }
        }
        return result
      }
    }

    const jjAction = async (
      title: string,
      args: readonly string[],
      options: { refresh?: boolean; success?: string } = {},
    ) => {
      const repository = jjRepository()
      if (!repository) return undefined
      try {
        const result = await run("jj", ["--no-pager", "--color=never", ...args], repository.cwd)
        if (options.refresh !== false) await refresh()
        if (options.success) toast.show({ variant: "success", message: options.success })
        return result.stdout.trim()
      } catch (error) {
        toast.show({ title, message: errorMessage(error), variant: "error" })
        return undefined
      }
    }

    const newTaskChange = async (message: string) => {
      const result = await jjAction("Unable to create a change", ["new", "-m", message], {
        success: "Version control: started a change",
      })
      if (result === undefined) return
      const change = await jjAction("Unable to read the new change", [
        "log",
        "--no-graph",
        "-r",
        "@",
        "-T",
        "change_id.short()",
      ])
      return change || undefined
    }

    const describeTask = async (ref: string, message: string) =>
      (await jjAction("Unable to describe the change", ["describe", "-r", ref, "-m", message], {
        success: "Version control: described the change",
      })) !== undefined

    const bookmarkTask = async (ref: string, bookmark: string) =>
      (await jjAction("Unable to set the bookmark", ["bookmark", "set", bookmark, "-r", ref], {
        success: `Version control: set ${bookmark}`,
      })) !== undefined

    const editTask = async (ref: string) =>
      (await jjAction("Unable to edit the change", ["edit", ref], {
        success: `Version control: switched to ${ref}`,
      })) !== undefined

    const squashTask = async (ref: string) =>
      (await jjAction("Unable to squash the change", ["squash", "--from", ref], {
        success: "Version control: squashed the change",
      })) !== undefined

    const abandonTask = async (ref: string) =>
      (await jjAction("Unable to abandon the change", ["abandon", ref], {
        success: "Version control: abandoned the change",
      })) !== undefined

    const isAncestor = async (ancestor: string, descendant: string) => {
      const repository = jjRepository()
      if (!repository) return false
      try {
        const result = await run(
          "jj",
          ["--no-pager", "--color=never", "log", "--no-graph", "-r", `${ancestor} & ::${descendant}`, "-T", "change_id.short()"],
          repository.cwd,
        )
        return result.stdout.trim().length > 0
      } catch {
        return false
      }
    }

    return {
      visible,
      summary,
      tool,
      refresh,
      openTool,
      openCommand,
      execute,
      patch,
      branches,
      remotes,
      history,
      show,
      switchTo,
      startChange,
      moveBookmark,
      branchAction,
      hunks,
      applyHunks,
      resolveLinks,
      newTaskChange,
      describeTask,
      bookmarkTask,
      editTask,
      squashTask,
      abandonTask,
      isAncestor,
    }
  },
})
