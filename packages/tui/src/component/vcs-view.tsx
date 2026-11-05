/** @jsxImportSource @opentui/solid */
import { TextAttributes, type BoxRenderable, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useVcs } from "../context/vcs"
import { errorMessage } from "../util/error"
import { Locale } from "../util/locale"
import {
  type VcsBranchAction,
  type VcsFile,
  type VcsListEntry,
  type VcsMutation,
  type VcsSummary,
} from "../util/vcs"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { FilePath } from "../ui/file-path"
import { revealSelectionOffset } from "../ui/select-controller"
import { useToast } from "../ui/toast"
import { DialogVcsFiles } from "./dialog-vcs-files"
import { DialogVcsHunks } from "./dialog-vcs-hunks"

export type VcsViewController = Pick<
  ReturnType<typeof useVcs>,
  | "summary"
  | "tool"
  | "refresh"
  | "openTool"
  | "openCommand"
  | "execute"
  | "patch"
  | "branches"
  | "remotes"
  | "history"
  | "show"
  | "switchTo"
  | "startChange"
  | "moveBookmark"
  | "branchAction"
  | "hunks"
  | "applyHunks"
> & {
  readonly gitBranches?: () => Promise<VcsListEntry[]>
  readonly gitHistory?: (ref?: string) => Promise<VcsListEntry[]>
  readonly gitShow?: (ref: string) => Promise<string>
  readonly gitSwitchTo?: (ref: string, options?: { localName?: string }) => Promise<void>
  readonly gitPush?: (branch?: string, remote?: string) => Promise<void>
  readonly tags?: () => Promise<VcsListEntry[]>
  readonly pushTag?: (tag: string, remote?: string) => Promise<void>
}

type VcsRefMode = "jj" | "git"

type VcsPanel = "status" | "files" | "branches" | "history"
const panels = ["status", "files", "branches", "history"] as const

export function VcsView(props: { onClose: () => void; controller?: VcsViewController }) {
  const vcs = props.controller ?? useVcs()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const toast = useToast()
  const keymap = Keymap.use()
  const [focus, setFocus] = createSignal<VcsPanel>("files")
  const initialSummary = vcs.summary()
  const [refMode, setRefMode] = createSignal<VcsRefMode>(
    initialSummary?.kind === "git" || initialSummary?.git ? "git" : "jj",
  )
  const [selection, setSelection] = createSignal<Record<VcsPanel, number>>({
    status: 0,
    files: 0,
    branches: 0,
    history: 0,
  })
  const scrolls: Partial<Record<VcsPanel, ScrollBoxRenderable>> = {}
  let root: BoxRenderable | undefined
  onMount(() => {
    const timer = setTimeout(() => {
      if (root && !root.isDestroyed) root.focus()
    }, 1)
    onCleanup(() => clearTimeout(timer))
  })

  const current = () => vcs.summary()
  const kind = () => current()?.kind
  const gitAvailable = () => current()?.git === true
  const refsAreGit = () => refMode() === "git"
  const canToggleRefs = () => kind() === "jj" && gitAvailable()
  let lastRepositoryMode = ""
  createEffect(() => {
    const key = `${kind() ?? "none"}:${gitAvailable() ? "git" : "jj"}`
    if (key === lastRepositoryMode) return
    lastRepositoryMode = key
    setRefMode(kind() === "git" || (kind() === "jj" && gitAvailable()) ? "git" : "jj")
  })
  const branchSource = () => (refsAreGit() ? (vcs.gitBranches?.() ?? vcs.branches()) : vcs.branches())
  const historySource = (ref?: string) =>
    refsAreGit() ? (vcs.gitHistory?.(ref) ?? vcs.history(ref)) : vcs.history()
  const showSource = (ref: string) => (refsAreGit() ? (vcs.gitShow?.(ref) ?? vcs.show(ref)) : vcs.show(ref))
  const switchSource = (ref: string, options?: { localName?: string }) =>
    refsAreGit() ? (vcs.gitSwitchTo?.(ref, options) ?? vcs.switchTo(ref, options)) : vcs.switchTo(ref, options)
  // The working-copy commit ID changes whenever a file is saved in jj. Keep the
  // stable change ID in the key so a content edit does not clear the panels.
  const summaryKey = (summary: VcsSummary) =>
    `${summary.kind}:${summary.git ? "git" : "jj"}:${summary.label}:${summary.change ?? ""}`
  const currentKey = () => {
    const summary = current()
    return summary ? summaryKey(summary) : undefined
  }
  const files = createMemo(() => current()?.files ?? [])
  const branchKey = () => {
    const summary = current()
    return summary ? `${summaryKey(summary)}:${refMode()}` : undefined
  }
  const [branchList] = createResource(
    () => {
      const key = branchKey()
      return key ? { key } : undefined
    },
    async (input) => {
      try {
        return { key: input.key, entries: await branchSource() }
      } catch {
        return { key: input.key, entries: [] }
      }
    },
  )
  const branchEntries = createMemo<VcsListEntry[]>(() => {
    const key = branchKey()
    if (!key) return []
    const entries =
      branchList()?.key === key
        ? branchList()!.entries
        : branchList.latest?.key === key
          ? branchList.latest.entries
          : []
    return entries.toSorted(
      (a, b) =>
        Number(Boolean(a.remote)) - Number(Boolean(b.remote)) ||
        Number(Boolean(b.current)) - Number(Boolean(a.current)) ||
        a.label.localeCompare(b.label),
    )
  })
  const localBranchEntries = createMemo(() => branchEntries().filter((item) => !item.remote))
  const remoteBranchEntries = createMemo(() => branchEntries().filter((item) => item.remote))
  const branchRowIndex = (entryIndex: number) => {
    const local = localBranchEntries().length
    if (local === 0) return remoteBranchEntries().length > 0 ? entryIndex + 1 : entryIndex
    return entryIndex < local ? entryIndex + 1 : entryIndex + 2
  }
  const contentCount = (panel: VcsPanel) => {
    if (panel !== "branches") return countFor(panel)
    return (
      branchEntries().length + (localBranchEntries().length > 0 ? 1 : 0) + (remoteBranchEntries().length > 0 ? 1 : 0)
    )
  }
  const selectedFor = (panel: VcsPanel) => selection()[panel]
  const setSelectedFor = (panel: VcsPanel, index: number) =>
    setSelection((value) => ({ ...value, [panel]: index }))
  const file = createMemo(() => files().at(selectedFor("files")))
  const branch = createMemo(() => branchEntries().at(selectedFor("branches")))
  const historyRef = () => (refsAreGit() ? branch()?.id : undefined)
  const historyKey = () => {
    const summary = current()
    if (!summary) return undefined
    return `${summaryKey(summary)}:${refMode()}:${historyRef() ?? ""}`
  }
  const [historyList] = createResource(
    () => {
      const key = historyKey()
      return key ? { key, ref: historyRef() } : undefined
    },
    async (input) => {
      try {
        return { key: input.key, entries: await historySource(input.ref) }
      } catch {
        return { key: input.key, entries: [] }
      }
    },
  )
  const historyEntries = createMemo<VcsListEntry[]>(() => {
    const key = historyKey()
    if (!key) return []
    if (historyList()?.key === key) return historyList()!.entries
    if (historyList.latest?.key === key) return historyList.latest.entries
    return []
  })
  const branchesLoading = () => {
    const key = branchKey()
    if (!key) return false
    return branchList.loading && branchList()?.key !== key && branchList.latest?.key !== key
  }
  const historyLoading = () => {
    const key = historyKey()
    if (!key) return false
    return historyList.loading && historyList()?.key !== key && historyList.latest?.key !== key
  }
  const historyEntry = createMemo(() => historyEntries().at(selectedFor("history")))
  const focusedEntry = () => (focus() === "branches" ? branch() : focus() === "history" ? historyEntry() : undefined)
  const focusedItem = () =>
    focus() === "files" ? file() : focus() === "branches" ? branch() : focus() === "history" ? historyEntry() : undefined
  const countFor = (panel: VcsPanel) => {
    if (panel === "files") return files().length
    if (panel === "branches") return branchEntries().length
    if (panel === "history") return historyEntries().length
    return 0
  }
  const sidebarWidth = () => Math.max(32, Math.min(56, Math.floor(dimensions().width * 0.4)))
  const listMinHeight = () => (dimensions().height >= 24 ? 5 : 3)
  const previewLabelWidth = () => Math.max(8, dimensions().width - sidebarWidth() - 36)
  const previewLabel = () => {
    if (focus() === "files") return file()?.file ?? current()?.detail ?? ""
    if (focus() === "branches") return branch()?.label ?? current()?.detail ?? ""
    if (focus() === "history") return historyEntry()?.label ?? current()?.detail ?? ""
    return current()?.label ?? ""
  }
  const previewDetail = () => {
    if (focus() === "status") return current() ? status(current()!) : ""
    if (focus() === "files") {
      const item = file()
      if (kind() !== "git" || !item) return ""
      return item.staged && !item.unstaged ? "staged" : "unstaged"
    }
    const item = focusedEntry()
    return Locale.truncateWidth(
      item?.detail ??
        (focus() === "branches"
          ? refsAreGit()
            ? "branch"
            : kind() === "jj"
              ? "bookmark"
              : "branch"
          : refsAreGit()
            ? "commit"
            : kind() === "jj"
              ? "change"
              : "commit"),
      24,
    )
  }
  const previewTitle = () => {
    if (focus() === "status") return "Repository"
    if (focus() === "files") return "Diff"
    if (focus() === "branches") return refsAreGit() ? "Branch" : kind() === "jj" ? "Bookmark" : "Branch"
    return refsAreGit() ? "Commit" : kind() === "jj" ? "Change" : "Commit"
  }
  const emptyPreview = () => {
    if (focus() === "files") return "No changed files"
    if (focus() === "branches") return refsAreGit() ? "No branches" : kind() === "jj" ? "No bookmarks" : "No branches"
    return refsAreGit() ? "No commits" : kind() === "jj" ? "No changes" : "No commits"
  }
  const source = createMemo(() => {
    const prefix = currentKey()
    if (!prefix) return
    const mode = refMode()
    if (focus() === "files") {
      const item = file()
      if (!item) return
      const staged = item.staged && !item.unstaged
      return { type: "file" as const, key: `${prefix}:${mode}:file:${item.file}:${staged}`, id: item.file, staged }
    }
    const item = focusedEntry()
    if (!item) return
    return { type: "ref" as const, key: `${prefix}:${mode}:ref:${item.id}`, id: item.id }
  })
  const [diff] = createResource(source, async (input) => {
    try {
      const text = input.type === "file" ? await vcs.patch(input.id, input.staged) : await showSource(input.id)
      return { key: input.key, text }
    } catch {
      return { key: input.key, text: "" }
    }
  })
  const diffText = () => {
    const key = source()?.key
    if (!key) return ""
    if (diff()?.key === key) return diff()!.text
    if (diff.latest?.key === key) return diff.latest.text
    return undefined
  }
  const diffLoading = () => source() !== undefined && diff.loading && diffText() === undefined
  const lines = createMemo(() => (diffText() ?? "").split("\n").slice(0, 2_000))

  const status = (summary: VcsSummary) =>
    summary.conflict ? "conflict" : summary.dirty === 0 ? "clean" : `${summary.dirty} changed`
  const statusColor = (summary: VcsSummary) =>
    summary.conflict
      ? theme.text.feedback.error.base
      : summary.dirty === 0
        ? theme.text.feedback.success.base
        : theme.text.feedback.warning.base
  const statusDetail = () => {
    const summary = current()
    if (!summary) return ""
    if (summary.kind !== "jj") return summary.detail
    return summary.description || summary.detail
  }
  const bookmarkNames = createMemo(() => current()?.bookmarks?.split(" ").filter(Boolean) ?? [])
  const branchDetail = (item: VcsListEntry) =>
    item.remote && !refsAreGit() && kind() === "jj"
      ? item.tracked
        ? "tracked"
        : "untracked"
      : (item.detail?.split(" · ")[0] ?? "")
  const branchDetailColor = (item: VcsListEntry) =>
    item.remote && !refsAreGit() && kind() === "jj"
      ? item.tracked
        ? theme.text.feedback.success.base
        : theme.text.feedback.warning.base
      : theme.text.muted
  const rowBackground = (panel: VcsPanel, index: number) => {
    if (selectedFor(panel) !== index) return undefined
    return focus() === panel ? theme.background.action.primary.focused : theme.background.raised.high
  }
  const rowColor = (panel: VcsPanel, index: number, color: RGBA) => {
    if (selectedFor(panel) !== index) return color
    return focus() === panel ? theme.text.action.primary.focused : theme.text.base
  }
  const branchColor = (panel: VcsPanel, index: number, item: VcsListEntry) =>
    rowColor(panel, index, item.current ? theme.text.feedback.success.base : item.remote ? theme.text.feedback.info.base : theme.text.muted)
  const historyColor = (panel: VcsPanel, index: number, item: VcsListEntry) =>
    rowColor(
      panel,
      index,
      kind() === "jj" && !refsAreGit() && current()?.change === item.id
        ? theme.text.feedback.success.base
        : theme.text.muted,
    )
  const previewDetailColor = () => {
    if (focus() === "files") {
      const item = file()
      if (kind() !== "git" || !item) return theme.text.muted
      return item.staged && !item.unstaged ? theme.text.feedback.success.base : theme.text.feedback.warning.base
    }
    return theme.text.muted
  }

  createEffect(() => {
    const panel = focus()
    const total = countFor(panel)
    setSelection((value) => {
      const next = Math.max(0, Math.min(value[panel], Math.max(0, total - 1)))
      return next === value[panel] ? value : { ...value, [panel]: next }
    })
  })

  createEffect(() => {
    const panel = focus()
    const index = selectedFor(panel)
    queueMicrotask(() => {
      const scroll = scrolls[panel]
      if (!scroll) return
      const limit = scroll.viewport.height
      if (limit <= 0) return
      const offset = revealSelectionOffset(scroll.scrollTop, {
        count: contentCount(panel),
        limit,
        selected: panel === "branches" ? branchRowIndex(index) : index,
      })
      if (offset !== scroll.scrollTop) scroll.scrollTo(offset)
    })
  })

  const cyclePanel = (delta: number) => {
    const index = panels.indexOf(focus())
    setFocus(panels[(index + delta + panels.length) % panels.length]!)
  }
  const move = (delta: number) => {
    const panel = focus()
    const total = countFor(panel)
    if (total === 0) return
    setSelection((value) => ({
      ...value,
      [panel]: Math.max(0, Math.min(total - 1, value[panel] + delta)),
    }))
  }

  const prompt = (
    title: string,
    placeholder: string,
    value: string,
    action: VcsMutation,
    paths: readonly string[] = [],
  ) => {
    dialog.replace(() => (
      <DialogPrompt
        title={title}
        placeholder={placeholder}
        value={value}
        onConfirm={(input) => {
          const next = input.trim()
          if (!next) return
          dialog.clear()
          void vcs.execute(action, next, paths)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const confirm = (title: string, message: string, action: VcsMutation) => {
    dialog.replace(() => (
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => {
          dialog.clear()
          void vcs.execute(action)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const promptBranch = (action: VcsBranchAction, input: { previous?: string; target?: string } = {}, value = "") => {
    const repository = kind()
    if (!repository) return
    const noun = repository === "jj" ? "bookmark" : "branch"
    const title = action === "rename" ? `Rename ${noun}` : action === "create" ? `Create ${noun}` : `Delete ${noun}`
    dialog.replace(() => (
      <DialogPrompt
        title={title}
        placeholder={`${noun[0]!.toUpperCase()}${noun.slice(1)} name`}
        value={value}
        onConfirm={(text) => {
          const name = text.trim()
          if (!name) return
          dialog.clear()
          void vcs.branchAction(action, { ...input, name })
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const switchTarget = (item: VcsListEntry) => {
    const localName = refsAreGit() && item.remote ? item.name : undefined
    void switchSource(item.id, localName ? { localName } : undefined)
  }
  const switchReference = () => {
    const item = focusedEntry()
    if (!item) return
    const start = !refsAreGit() && kind() === "jj" && item.immutable
    if (focus() === "history") {
      const noun = refsAreGit() ? "commit" : kind() === "jj" ? "change" : "commit"
      dialog.replace(() => (
        <DialogConfirm
          title={start ? `Start a new change from ${item.id}?` : `Switch to ${item.id}?`}
          message={
            start
              ? "This creates a new empty change on top of the selected change."
              : `This moves the working copy to the selected ${noun}.`
          }
          label={start ? { confirm: "new" } : undefined}
          onConfirm={() => {
            dialog.clear()
            if (start) void vcs.startChange(item.id)
            else switchTarget(item)
          }}
          onCancel={() => dialog.clear()}
        />
      ))
      return
    }
    if (start) {
      void vcs.startChange(item.id)
      return
    }
    switchTarget(item)
  }
  const deleteReference = () => {
    const repository = kind()
    const item = branch()
    if (!repository || !item || focus() !== "branches") return
    if (item.remote) {
      toast.show({
        variant: "info",
        message:
          repository === "jj"
            ? "Remote bookmarks are managed by jj git."
            : "Remote branches are deleted from the command line with git push --delete.",
      })
      return
    }
    const noun = repository === "jj" ? "bookmark" : "branch"
    dialog.replace(() => (
      <DialogConfirm
        title={`Delete ${noun} ${item.label}?`}
        message={`This deletes the ${noun}.`}
        onConfirm={() => {
          dialog.clear()
          void vcs.branchAction("delete", { previous: item.label })
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const createReference = () => {
    if (focus() === "branches") {
      promptBranch("create")
      return
    }
    const item = historyEntry()
    if (focus() === "history" && item) promptBranch("create", { target: item.id })
  }
  const renameReference = () => {
    const item = branch()
    if (focus() !== "branches" || !item) return
    if (item.remote) {
      toast.show({
        variant: "info",
        message:
          kind() === "jj"
            ? "Remote bookmarks are managed by jj git."
            : "Remote branches are renamed from the command line.",
      })
      return
    }
    promptBranch("rename", { previous: item.label }, item.label)
  }
  const stageSelected = () => {
    const item = file()
    if (!item || focus() !== "files" || kind() !== "git") return
    void vcs.execute(item.unstaged ? "stage" : "unstage", undefined, [item.file])
  }
  const openHunks = async (staged: boolean) => {
    const item = file()
    if (!item || focus() !== "files" || kind() !== "git") return
    try {
      const patch = await vcs.hunks(item.file, staged)
      if (patch.hunks.length === 0) {
        toast.show({ variant: "info", message: `No hunks available for ${item.file}` })
        return
      }
      const selectedPatch = await DialogVcsHunks.show(dialog, {
        title: staged ? `Unstage hunks · ${item.file}` : `Stage hunks · ${item.file}`,
        description: "Select hunks with space, then confirm.",
        confirmLabel: staged ? "unstage" : "stage",
        patch,
      })
      if (!selectedPatch) return
      await vcs.applyHunks(selectedPatch, staged)
    } catch (error) {
      toast.show({ variant: "error", title: "Failed to read hunks", message: errorMessage(error) })
    }
  }
  const splitFiles = async (parallel: boolean) => {
    const repository = current()
    if (repository?.kind !== "jj" || repository.files.length === 0) return
    const paths = await DialogVcsFiles.show(dialog, {
      title: parallel ? "Split files into parallel change" : "Split files into new change",
      description: "Select the files that move into the new change.",
      confirmLabel: "split",
      files: repository.files,
    })
    if (!paths?.length) return
    prompt("Split description", "Description for the new change", "", parallel ? "split_parallel" : "split", paths)
  }
  const openExternal = () => {
    if (!vcs.tool()) return
    props.onClose()
    void vcs.openTool()
  }
  const openInteractiveSplit = () => {
    props.onClose()
    void vcs.openCommand("jj split", "jj", ["split", "-i"])
  }
  const openDiff = () => {
    props.onClose()
    keymap.dispatch("diff.open")
  }
  const runAction = (action: VcsMutation) => {
    if (!kind()) return
    void vcs.execute(action)
  }
  const chooseRemote = async (
    title: string,
    run: (remote: string | undefined) => void,
    describe?: (remote: string) => string | undefined,
  ) => {
    const names = await vcs.remotes()
    if (names.length <= 1) {
      dialog.clear()
      run(names[0])
      return
    }
    const currentRemote = names.includes("origin") ? "origin" : names[0]
    dialog.replace(() => (
      <DialogSelect
        title={title}
        options={names.map((name) => ({ title: name, value: name, description: describe?.(name) }))}
        current={currentRemote}
        onSelect={(option) => {
          dialog.clear()
          run(option.value)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const bookmarkTracking = (item: VcsListEntry) => {
    const remotes = branchEntries().filter((entry) => entry.remote && entry.name === item.name)
    if (remotes.length === 0) return refsAreGit() ? "no remote branch" : "not tracked"
    return remotes
      .map((entry) =>
        refsAreGit() ? entry.label : `${entry.label} ${entry.tracked ? "tracked" : "untracked"}`,
      )
      .join(", ")
  }
  const pushToRemote = async (bookmark: string) => {
    await chooseRemote(
      "Push remote",
      (remote) => void vcs.execute("push", bookmark, [], remote),
      (remote) => {
        const target = branchEntries().find(
          (entry) => entry.remote && entry.name === bookmark && entry.remoteName === remote,
        )
        return target ? `${target.label} ${target.tracked ? "tracked" : "untracked"}` : `new ${bookmark}@${remote}`
      },
    )
  }
  const hasLocalBranch = (name: string) =>
    localBranchEntries().some((item) => (item.name ?? item.label) === name)
  const pushBranchToRemote = async (branch: string, remote?: string) => {
    const push = (name?: string) => {
      if (refsAreGit()) return vcs.gitPush?.(branch, name) ?? vcs.execute("push", branch, [], name)
      return vcs.execute("push", branch, [], name)
    }
    if (remote) {
      void push(remote)
      return
    }
    await chooseRemote(
      "Push remote",
      (name) => void push(name),
      (name) => {
        const target = branchEntries().find(
          (entry) => entry.remote && entry.remoteName === name && entry.name === branch,
        )
        return target ? target.label : `new ${name}/${branch}`
      },
    )
  }
  const pushBookmarks = async () => {
    const repository = kind()
    if (!repository) return
    if (refsAreGit()) {
      const selected = focus() === "branches" ? branch() : undefined
      if (selected?.remote) {
        const name = selected.name
        if (!name || !hasLocalBranch(name)) {
          toast.show({
            variant: "warning",
            message: `No local branch named ${name ?? selected.label} to push.`,
          })
          return
        }
        if (!selected.remoteName) return
        await pushBranchToRemote(name, selected.remoteName)
        return
      }
      if (selected) {
        await pushBranchToRemote(selected.label)
        return
      }
      const local = localBranchEntries()
      if (local.length === 0) {
        await chooseRemote("Push remote", (remote) => void (vcs.gitPush?.(undefined, remote) ?? vcs.execute("push", undefined, [], remote)))
        return
      }
      if (local.length === 1) {
        await pushBranchToRemote(local[0]!.label)
        return
      }
      dialog.replace(() => (
        <DialogSelect
          title="Push branch"
          options={local.map((item) => ({
            title: item.label,
            value: item.label,
            description: [item.current ? "current" : undefined, bookmarkTracking(item)].filter(Boolean).join(" · "),
          }))}
          current={local.find((item) => item.current)?.label}
          onSelect={(option) => void pushBranchToRemote(option.value)}
          onCancel={() => dialog.clear()}
        />
      ))
      return
    }
    const local = localBranchEntries()
    if (local.length === 0) {
      toast.show({ variant: "warning", message: "No local bookmarks to push." })
      return
    }
    const selected = focus() === "branches" ? branch() : undefined
    if (selected && !selected.remote) {
      await pushToRemote(selected.label)
      return
    }
    if (local.length === 1) {
      await pushToRemote(local[0]!.label)
      return
    }
    dialog.replace(() => (
      <DialogSelect
        title="Push bookmark"
        options={local.map((item) => ({
          title: item.label,
          value: item.label,
          description: [item.current ? "at @" : undefined, bookmarkTracking(item)].filter(Boolean).join(" · "),
        }))}
        current={local.find((item) => item.current)?.label}
        onSelect={(option) => void pushToRemote(option.value)}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const pushTag = async () => {
    if (!kind()) return
    const available = await (vcs.tags?.() ?? Promise.resolve([])).catch(() => [])
    const choose = (tag: string) => {
      void chooseRemote(
        "Push tag remote",
        (remote) => void (vcs.pushTag?.(tag, remote) ?? Promise.resolve()),
        (remote) => (tag === "*" ? `all tags to ${remote}` : `${tag} to ${remote}`),
      )
    }
    if (available.length > 0) {
      dialog.replace(() => (
        <DialogSelect
          title="Push tag"
          options={[
            { title: "All tags", value: "*", description: "Push every tag" },
            ...available.map((item) => ({ title: item.label, value: item.id, description: item.detail })),
          ]}
          onSelect={(option) => {
            dialog.clear()
            choose(option.value)
          }}
          onCancel={() => dialog.clear()}
        />
      ))
      return
    }
    dialog.replace(() => (
      <DialogPrompt
        title="Push tag"
        placeholder="Tag name, or * for all tags"
        value=""
        onConfirm={(input) => {
          const tag = input.trim()
          if (!tag) return
          dialog.clear()
          choose(tag)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const fetchScope = (remote?: string) => {
    dialog.replace(() => (
      <DialogSelect
        title={remote ? `Fetch from ${remote}` : "Fetch"}
        options={[
          { title: "All refs", value: "all", description: "Bookmarks and tags" },
          { title: "Tracked only", value: "tracked", description: "Tracked bookmarks and tags" },
          { title: "Bookmarks only", value: "bookmarks", description: "Skip tags" },
          { title: "Tags only", value: "tags", description: "Skip bookmarks" },
        ]}
        current="all"
        onSelect={(option) => {
          dialog.clear()
          void vcs.execute("fetch", option.value === "all" ? undefined : option.value, [], remote)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const fetchRemotes = async () => {
    const repository = kind()
    if (!repository) return
    if (repository !== "jj") {
      await chooseRemote("Fetch remote", (remote) => void vcs.execute("fetch", undefined, [], remote))
      return
    }
    await chooseRemote("Fetch remote", (remote) => fetchScope(remote))
  }
  const trackAllBookmarks = () => {
    if (kind() !== "jj" || focus() !== "branches") return
    void vcs.execute("track", "*")
  }
  const untrackAllBookmarks = () => {
    if (kind() !== "jj" || focus() !== "branches") return
    dialog.replace(() => (
      <DialogConfirm
        title="Untrack all remote bookmarks?"
        message="They will no longer be imported as local bookmarks."
        onConfirm={() => {
          dialog.clear()
          void vcs.execute("untrack", "*")
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const toggleTracking = () => {
    const item = branch()
    if (focus() !== "branches" || !item?.remote) return
    void vcs.execute(item.tracked ? "untrack" : "track", item.id)
  }
  const moveBookmarkToRevset = () => {
    const item = branch()
    if (kind() !== "jj" || focus() !== "branches" || !item || item.remote) return
    dialog.replace(() => (
      <DialogPrompt
        title={`Move bookmark ${item.label}`}
        placeholder="Target revset"
        value="@"
        onConfirm={(value) => {
          const target = value.trim()
          if (!target) return
          dialog.clear()
          void vcs.moveBookmark(item.label, target)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const moveBookmarkToChange = () => {
    const target = historyEntry()
    if (focus() !== "history" || !target || kind() !== "jj") return
    const local = localBranchEntries()
    if (local.length === 0) {
      toast.show({ variant: "warning", message: "No local bookmarks to move." })
      return
    }
    if (local.length === 1) {
      void vcs.moveBookmark(local[0]!.label, target.id)
      return
    }
    dialog.replace(() => (
      <DialogSelect
        title={`Move bookmark to ${target.id}`}
        options={local.map((item) => ({
          title: item.label,
          value: item.label,
          description: item.current ? "at @" : item.detail,
        }))}
        current={local.find((item) => item.current)?.label}
        onSelect={(option) => {
          dialog.clear()
          void vcs.moveBookmark(option.value, target.id)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    // Let modified shortcuts reach the global keymap, e.g. ctrl+tab for session tabs.
    if (event.ctrl || event.meta || event.option || event.super || event.hyper || event.shift) return
    const repository = kind()
    const key = event.name
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (key === "escape" || key === "q") {
      handled()
      props.onClose()
      return
    }
    if (key === "1") {
      handled()
      setFocus("status")
      return
    }
    if (key === "2") {
      handled()
      setFocus("files")
      return
    }
    if (key === "3") {
      handled()
      setFocus("branches")
      return
    }
    if (key === "4") {
      handled()
      setFocus("history")
      return
    }
    if (key === "tab" || key === "right") {
      handled()
      cyclePanel(1)
      return
    }
    if (key === "left") {
      handled()
      cyclePanel(-1)
      return
    }
    if (key === "up" || key === "k") {
      handled()
      move(-1)
      return
    }
    if (key === "down" || key === "j") {
      handled()
      move(1)
      return
    }
    if (key === "home") {
      handled()
      setSelectedFor(focus(), 0)
      return
    }
    if (key === "g" && canToggleRefs()) {
      handled()
      setRefMode((value) => (value === "git" ? "jj" : "git"))
      return
    }
    if ((key === "[" || key === "]") && canToggleRefs()) {
      handled()
      setRefMode(key === "]" ? "git" : "jj")
      return
    }
    if (key === "end") {
      handled()
      setSelectedFor(focus(), Math.max(0, countFor(focus()) - 1))
      return
    }
    if (key === "pageup" || key === "pagedown") {
      handled()
      const page = Math.max(1, (scrolls[focus()]?.viewport.height ?? 1) - 1)
      move(key === "pagedown" ? page : -page)
      return
    }
    if (key === "r") {
      handled()
      void vcs.refresh()
      return
    }
    if (key === "f" && repository) {
      handled()
      void fetchRemotes()
      return
    }
    if (key === "p" && repository) {
      handled()
      void pushBookmarks()
      return
    }
    if (key === "l" && repository === "git") {
      handled()
      runAction("pull")
      return
    }
    if (key === "o") {
      handled()
      openExternal()
      return
    }
    if (key === "enter" || key === "return") {
      handled()
      if (focus() === "files") openDiff()
      else if (focus() === "branches" || focus() === "history") switchReference()
      return
    }
    if ((key === "space" || event.sequence === " ") && focus() === "files") {
      handled()
      stageSelected()
      return
    }
    if (key === "n") {
      handled()
      if (focus() === "files") {
        if (repository === "jj") runAction("new")
      } else if ((focus() === "branches" || focus() === "history") && branchMutationsAllowed()) createReference()
      return
    }
    if (key === "x" && focus() === "branches" && branchMutationsAllowed()) {
      handled()
      deleteReference()
      return
    }
    if (key === "m" && focus() === "branches" && branchMutationsAllowed()) {
      handled()
      renameReference()
      return
    }
    if (key === "b" && focus() === "branches" && !refsAreGit()) {
      handled()
      moveBookmarkToRevset()
      return
    }
    if (key === "b" && focus() === "history" && !refsAreGit()) {
      handled()
      moveBookmarkToChange()
      return
    }
    if (key === "t" && refsAreGit() && focus() !== "files") {
      handled()
      void pushTag()
      return
    }
    if (key === "t" && (focus() === "status" || focus() === "history") && !refsAreGit()) {
      handled()
      void pushTag()
      return
    }
    if (key === "t" && focus() === "branches" && !refsAreGit()) {
      handled()
      toggleTracking()
      return
    }
    if (key === "s" && focus() === "branches" && !refsAreGit()) {
      handled()
      trackAllBookmarks()
      return
    }
    if (key === "u" && focus() === "branches" && !refsAreGit()) {
      handled()
      untrackAllBookmarks()
      return
    }
    if (focus() !== "files") return
    if (key === "c" && repository === "git") {
      handled()
      prompt("Commit staged changes", "Commit message", "", "commit")
      return
    }
    if (key === "a" && (repository === "git" || repository === "jj")) {
      handled()
      if (repository === "git") prompt("Commit all changes", "Commit message", "", "commit_all")
      else confirm("Abandon change?", "The current change and its description will be abandoned.", "abandon")
      return
    }
    if (key === "d" && repository === "jj") {
      handled()
      prompt("Describe change", "Change description", current()?.description ?? "", "describe")
      return
    }
    if (key === "s" && repository === "jj") {
      handled()
      runAction("squash")
      return
    }
    if (key === "b" && repository === "jj") {
      handled()
      prompt("Set bookmark", "Bookmark name", "", "bookmark")
      return
    }
    if (key === "e" && repository === "jj") {
      handled()
      prompt("Edit change", "Revset", "@-", "edit")
      return
    }
    if (key === "v" && repository === "jj") {
      handled()
      void splitFiles(false)
      return
    }
    if (key === "w" && repository === "jj") {
      handled()
      void splitFiles(true)
      return
    }
    if (key === "i" && repository === "jj") {
      handled()
      openInteractiveSplit()
      return
    }
    if (key === "h" && repository === "git") {
      handled()
      void openHunks(false)
      return
    }
    if (key === "u" && repository === "git") {
      handled()
      void openHunks(true)
      return
    }
  })

  const marker = (item: VcsFile) => {
    if (item.conflict) return "!"
    return item.status === "added" ? "A" : item.status === "deleted" ? "D" : "M"
  }
  const markerColor = (item: VcsFile) => {
    if (item.conflict) return theme.text.feedback.error.base
    if (item.status === "added") return theme.diff.highlight.added
    if (item.status === "deleted") return theme.diff.highlight.removed
    return theme.text.feedback.warning.base
  }
  const diffColor = (line: string) => {
    if (line.startsWith("@@")) return theme.diff.text.hunkHeader
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index "))
      return theme.text.muted
    if (line.startsWith("+")) return theme.diff.highlight.added
    if (line.startsWith("-")) return theme.diff.highlight.removed
    return theme.text.base
  }
  const diffBackground = (line: string) => {
    if (line.startsWith("+++") || line.startsWith("---")) return undefined
    if (line.startsWith("+")) return theme.diff.background.added
    if (line.startsWith("-")) return theme.diff.background.removed
    return undefined
  }
  type Hint = { readonly key: string; readonly label: string }
  const panelLabel = (panel: VcsPanel) => {
    if (panel === "status") return "status"
    if (panel === "files") return "files"
    if (panel === "branches") return refsAreGit() ? "branches" : kind() === "jj" ? "bookmarks" : "branches"
    return refsAreGit() ? "commits" : kind() === "jj" ? "changes" : "commits"
  }
  const panelTitle = (panel: VcsPanel) => {
    if (panel === "status") return "Status"
    if (panel === "files") return `Files · ${files().length}`
    if (panel === "branches")
      return `${refsAreGit() ? "Branches" : kind() === "jj" ? "Bookmarks" : "Branches"} · ${branchEntries().length}`
    return `${refsAreGit() ? "Commits" : kind() === "jj" ? "Changes" : "Commits"} · ${historyEntries().length}`
  }
  const referenceAction = () =>
    refsAreGit() ? "switch" : focusedEntry()?.immutable ? "new" : kind() === "jj" ? "edit" : "switch"
  const branchMutationsAllowed = () => kind() === "git" || !refsAreGit()
  const contextHints = (): Hint[] => {
    const repository = kind()
    const toggleHint = canToggleRefs() ? [{ key: "g", label: refsAreGit() ? "jj" : "git" }] : []
    if (focus() === "status")
      return [
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
        { key: "t", label: "push tag" },
        ...toggleHint,
      ]
    if (focus() === "branches") {
      if (refsAreGit())
        return [
          { key: "enter", label: "switch" },
          ...(repository === "git"
            ? [
                { key: "n", label: "create" },
                { key: "m", label: "rename" },
                { key: "x", label: "delete" },
              ]
            : []),
          { key: "f", label: "fetch" },
          { key: "p", label: "push" },
          { key: "t", label: "push tag" },
          ...toggleHint,
        ]
      const item = branch()
      const local = !item?.remote
      return [
        { key: "enter", label: referenceAction() },
        { key: "n", label: "create" },
        ...(local
          ? [
              ...(repository === "jj" ? [{ key: "b", label: "move" }] : []),
              { key: "m", label: "rename" },
              { key: "x", label: "delete" },
            ]
          : repository === "jj"
            ? [{ key: "t", label: item?.tracked ? "untrack" : "track" }]
            : []),
        ...(repository === "jj" && remoteBranchEntries().length > 0
          ? [
              { key: "s", label: "track all" },
              { key: "u", label: "untrack all" },
            ]
          : []),
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
        ...toggleHint,
      ]
    }
    if (focus() === "history") {
      if (refsAreGit())
        return [
          { key: "enter", label: "switch" },
          { key: "f", label: "fetch" },
          { key: "p", label: "push" },
          { key: "t", label: "push tag" },
          ...toggleHint,
        ]
      return [
        { key: "enter", label: referenceAction() },
        { key: "n", label: repository === "jj" ? "bookmark at change" : "branch at commit" },
        ...(repository === "jj" ? [{ key: "b", label: "move bookmark here" }] : []),
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
        ...toggleHint,
      ]
    }
    if (repository === "git")
      return [
        { key: "enter", label: "diff" },
        { key: "space", label: "stage" },
        { key: "c", label: "commit" },
        { key: "a", label: "commit all" },
        { key: "h", label: "stage hunks" },
        { key: "u", label: "unstage hunks" },
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
        { key: "l", label: "pull" },
      ]
    if (repository === "jj")
      return [
        { key: "enter", label: "diff" },
        { key: "d", label: "describe" },
        { key: "n", label: "new" },
        { key: "s", label: "squash" },
        { key: "b", label: "bookmark" },
        { key: "a", label: "abandon" },
        { key: "e", label: "edit" },
        { key: "v", label: "split" },
        { key: "w", label: "parallel" },
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
      ]
    return []
  }
  const globalHints = (): Hint[] => [
    { key: "1", label: "status" },
    { key: "2", label: "files" },
    { key: "3", label: panelLabel("branches") },
    { key: "4", label: panelLabel("history") },
    { key: "tab", label: "panel" },
    ...(vcs.tool() ? [{ key: "o", label: "external" }] : []),
    { key: "r", label: "refresh" },
    { key: "q", label: "close" },
  ]
  const hintRow = (items: readonly Hint[]) => (
    <box height={1} flexDirection="row" gap={2}>
      <For each={items}>
        {(item) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme.text.base} selectable={false}>
              <b>{item.key}</b>
            </text>
            <text fg={theme.text.muted} selectable={false}>
              {item.label}
            </text>
          </box>
        )}
      </For>
    </box>
  )

  const listPanel = (panel: VcsPanel, title: string, body: JSX.Element) => (
    <box
      flexGrow={focus() === panel ? 2 : 1}
      minHeight={listMinHeight()}
      flexDirection="column"
      border
      borderColor={focus() === panel ? theme.background.action.primary.focused : theme.border.base}
      title={title}
      titleColor={focus() === panel ? theme.text.base : theme.text.muted}
      backgroundColor={theme.background.raised.base}
      onMouseDown={() => setFocus(panel)}
    >
      {body}
    </box>
  )
  const emptyRow = (message: string) => (
    <box height={1} paddingLeft={1}>
      <text fg={theme.text.muted} selectable={false}>
        {message}
      </text>
    </box>
  )
  const groupHeader = (label: string) => (
    <box height={1} paddingLeft={1}>
      <text fg={theme.text.muted} selectable={false}>
        <b>{label}</b>
      </text>
    </box>
  )
  const branchRow = (item: () => VcsListEntry, index: number) => (
    <box
      height={1}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={rowBackground("branches", index)}
      onMouseUp={() => {
        setFocus("branches")
        setSelectedFor("branches", index)
      }}
    >
      <text
        fg={rowColor(
          "branches",
          index,
          item().current ? theme.text.feedback.success.base : theme.text.muted,
        )}
        width={2}
        selectable={false}
      >
        {item().current ? (kind() === "jj" ? "@" : "*") : " "}
      </text>
      <text fg={branchColor("branches", index, item())} wrapMode="none" selectable={false}>
        {Locale.truncateWidth(item().label, sidebarWidth() - 17)}
      </text>
      <box flexGrow={1} />
      <text fg={rowColor("branches", index, branchDetailColor(item()))} selectable={false}>
        {Locale.truncateWidth(branchDetail(item()), 10)}
      </text>
    </box>
  )

  return (
    <box
      ref={(node: BoxRenderable) => (root = node)}
      width="100%"
      height="100%"
      flexDirection="column"
      focusable
      backgroundColor={theme.background.base}
      onMouseDown={() => root?.focus()}
    >
      <Show
        when={current()}
        fallback={
          <box flexGrow={1} paddingLeft={1} paddingTop={1}>
            <text fg={theme.text.muted}>No Git, jj, or Mercurial repository in this project.</text>
          </box>
        }
      >
        <Show when={canToggleRefs()}>
          <box height={1} flexShrink={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={refsAreGit() ? theme.background.raised.base : theme.background.action.primary.focused}
              onMouseUp={(event) => {
                event.stopPropagation()
                setRefMode("jj")
              }}
            >
              <text fg={refsAreGit() ? theme.text.muted : theme.text.action.primary.focused} selectable={false}>
                <b>jj</b>
              </text>
            </box>
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={refsAreGit() ? theme.background.action.primary.focused : theme.background.raised.base}
              onMouseUp={(event) => {
                event.stopPropagation()
                setRefMode("git")
              }}
            >
              <text fg={refsAreGit() ? theme.text.action.primary.focused : theme.text.muted} selectable={false}>
                <b>git</b>
              </text>
            </box>
            <box flexGrow={1} />
            <text fg={theme.text.muted} selectable={false}>
              g switch
            </text>
          </box>
        </Show>
        <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <box width={sidebarWidth()} flexShrink={0} flexDirection="column">
            <box
              height={4}
              flexShrink={0}
              flexDirection="column"
              border
              borderColor={
                focus() === "status" ? theme.background.action.primary.focused : theme.border.base
              }
              title="Status"
              titleColor={focus() === "status" ? theme.text.base : theme.text.muted}
              backgroundColor={theme.background.raised.base}
              onMouseDown={() => setFocus("status")}
            >
              <box height={2} flexDirection="column" paddingLeft={1} paddingRight={1}>
                <box height={1} flexDirection="row">
                  <text fg={theme.text.feedback.info.base} selectable={false}>
                    <b>{kind() ?? "vcs"}</b>
                  </text>
                  <Show when={gitAvailable() && kind() === "jj"}>
                    <text fg={theme.text.muted} selectable={false}>
                      {" git"}
                    </text>
                  </Show>
                  <box flexGrow={1} minWidth={0}>
                    <Show
                      when={kind() === "jj" && current()!.change}
                      fallback={
                        <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                          {` ${current()!.label}`}
                        </text>
                      }
                    >
                      <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                        <span style={{ fg: theme.text.muted }}> @ </span>
                        {current()!.change}
                      </text>
                    </Show>
                  </box>
                  <text fg={statusColor(current()!)} selectable={false}>
                    {status(current()!)}
                  </text>
                </box>
                <box height={1}>
                  <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                    {statusDetail()}
                  </text>
                </box>
              </box>
            </box>
            {listPanel(
              "files",
              panelTitle("files"),
              <scrollbox ref={(node) => (scrolls.files = node)} flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                <Show when={files().length > 0} fallback={emptyRow("No changed files")}>
                  <Index each={files()}>
                    {(item, index) => {
                      return (
                        <box
                          height={1}
                          flexDirection="row"
                          paddingLeft={1}
                          paddingRight={1}
                          backgroundColor={rowBackground("files", index)}
                          onMouseUp={() => {
                            setFocus("files")
                            setSelectedFor("files", index)
                          }}
                        >
                          <text
                            fg={rowColor("files", index, markerColor(item()))}
                            attributes={TextAttributes.BOLD}
                            selectable={false}
                          >
                            {marker(item())}
                          </text>
                          <box width={1} />
                          <FilePath
                            value={item().file}
                            maxWidth={sidebarWidth() - 9}
                            fg={rowColor("files", index, theme.text.muted)}
                          />
                          <box flexGrow={1} />
                          <Show when={item().staged}>
                            <text fg={rowColor("files", index, theme.text.feedback.success.base)} selectable={false}>
                              +
                            </text>
                          </Show>
                        </box>
                      )
                    }}
                  </Index>
                </Show>
              </scrollbox>,
            )}
            {listPanel(
              "branches",
              panelTitle("branches"),
              <scrollbox ref={(node) => (scrolls.branches = node)} flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                <Show when={!branchesLoading()} fallback={emptyRow("Loading…")}>
                  <Show
                    when={branchEntries().length > 0}
                    fallback={emptyRow(refsAreGit() ? "No branches" : kind() === "jj" ? "No bookmarks" : "No branches")}
                  >
                    <Show when={localBranchEntries().length > 0}>
                      {groupHeader(`Local · ${localBranchEntries().length}`)}
                      <Index each={localBranchEntries()}>
                        {(item, index) => branchRow(item, index)}
                      </Index>
                    </Show>
                    <Show when={remoteBranchEntries().length > 0}>
                      {groupHeader(`Remote · ${remoteBranchEntries().length}`)}
                      <Index each={remoteBranchEntries()}>
                        {(item, index) => branchRow(item, localBranchEntries().length + index)}
                      </Index>
                    </Show>
                  </Show>
                </Show>
              </scrollbox>,
            )}
            {listPanel(
              "history",
              panelTitle("history"),
              <scrollbox ref={(node) => (scrolls.history = node)} flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                <Show when={!historyLoading()} fallback={emptyRow("Loading…")}>
                  <Show
                    when={historyEntries().length > 0}
                    fallback={emptyRow(refsAreGit() ? "No commits" : kind() === "jj" ? "No changes" : "No commits")}
                  >
                    <Index each={historyEntries()}>
                      {(item, index) => {
                        const isCurrent = () =>
                          !refsAreGit() && (item().current || (kind() === "jj" && current()?.change === item().id))
                        const marker = () =>
                          refsAreGit() ? (item().merge ? "M" : " ") : isCurrent() ? (kind() === "jj" ? "@" : "*") : " "
                        const markerColor = () =>
                          refsAreGit() && item().merge
                            ? theme.text.feedback.info.base
                            : isCurrent()
                              ? theme.text.feedback.success.base
                              : theme.text.muted
                        return (
                          <box
                            height={1}
                            flexDirection="row"
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={rowBackground("history", index)}
                            onMouseUp={() => {
                              setFocus("history")
                              setSelectedFor("history", index)
                            }}
                          >
                            <text fg={rowColor("history", index, markerColor())} width={2} selectable={false}>
                              {marker()}
                            </text>
                            <text
                              fg={historyColor("history", index, item())}
                              wrapMode="none"
                              selectable={false}
                            >
                              {Locale.truncateWidth(item().label, sidebarWidth() - 15)}
                            </text>
                            <box flexGrow={1} />
                            <text fg={rowColor("history", index, theme.text.muted)} selectable={false}>
                              {Locale.truncateWidth(item().detail?.split(" · ")[0] ?? "", 8)}
                            </text>
                          </box>
                        )
                      }}
                    </Index>
                  </Show>
                </Show>
              </scrollbox>,
            )}
          </box>
          <box
            flexGrow={1}
            minWidth={0}
            border
            borderColor={theme.border.base}
            title={previewTitle()}
            titleColor={theme.text.muted}
            backgroundColor={theme.background.raised.base}
          >
            <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                  {Locale.truncateWidth(previewLabel(), previewLabelWidth())}
                </text>
              </box>
              <text fg={previewDetailColor()} selectable={false}>
                {previewDetail()}
              </text>
            </box>
            <Show
              when={focus() === "status"}
              fallback={
                <Show
                  when={focusedItem()}
                  fallback={
                    <box paddingLeft={1} paddingTop={1}>
                      <text fg={theme.text.muted} selectable={false}>
                        {emptyPreview()}
                      </text>
                    </box>
                  }
                >
                  <Show
                    when={!diffLoading()}
                    fallback={
                      <box paddingLeft={1} paddingTop={1}>
                        <text fg={theme.text.muted}>Loading…</text>
                      </box>
                    }
                  >
                    <Show
                      when={lines().length > 0 && lines()[0] !== ""}
                      fallback={
                        <box paddingLeft={1} paddingTop={1}>
                          <text fg={theme.text.muted}>
                            {focus() === "files" ? "No diff for this file." : "No details for this entry."}
                          </text>
                        </box>
                      }
                    >
                      <scrollbox flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                        <For each={lines()}>
                          {(line) => (
                            <text
                              fg={diffColor(line)}
                              bg={diffBackground(line)}
                              attributes={line.startsWith("@@") ? TextAttributes.BOLD : undefined}
                              wrapMode="none"
                              selectable={false}
                            >
                              {line || " "}
                            </text>
                          )}
                        </For>
                      </scrollbox>
                    </Show>
                  </Show>
                </Show>
              }
            >
              <scrollbox flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                <box flexDirection="column" paddingLeft={1} paddingTop={1}>
                  <box height={1} flexDirection="row">
                    <text fg={theme.text.feedback.info.base} selectable={false}>
                      <b>{kind() ?? "vcs"}</b>
                    </text>
                    <Show
                      when={kind() === "jj" && current()!.change}
                      fallback={
                        <text fg={theme.text.base} selectable={false}>
                          {` ${current()!.label}`}
                        </text>
                      }
                    >
                      <text fg={theme.text.muted} selectable={false}>
                        {" @ "}
                      </text>
                      <text fg={theme.text.base} selectable={false}>
                        {current()!.change}
                      </text>
                    </Show>
                  </box>
                  <text fg={statusColor(current()!)} selectable={false}>
                    {status(current()!)}
                  </text>
                  <For each={bookmarkNames()}>
                    {(bookmark) => (
                      <box height={1} flexDirection="row">
                        <text fg={theme.text.muted} selectable={false}>
                          bookmark{" "}
                        </text>
                        <text fg={theme.text.feedback.success.base} selectable={false}>
                          {bookmark}
                        </text>
                      </box>
                    )}
                  </For>
                  <Show when={current()!.description}>
                    <text fg={theme.text.muted} selectable={false}>
                      {current()!.description!}
                    </text>
                  </Show>
                  <Show when={current()!.commit}>
                    <box height={1} flexDirection="row">
                      <text fg={theme.text.muted} selectable={false}>
                        commit{" "}
                      </text>
                      <text fg={theme.text.feedback.info.base} selectable={false}>
                        {current()!.commit}
                      </text>
                    </box>
                  </Show>
                  <text fg={theme.text.muted} selectable={false}>
                    {current()!.detail}
                  </text>
                </box>
              </scrollbox>
            </Show>
          </box>
        </box>
      </Show>
      <box
        flexShrink={0}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.background.raised.base}
      >
        {hintRow(contextHints())}
        {hintRow(globalHints())}
      </box>
    </box>
  )
}
