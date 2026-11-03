/** @jsxImportSource @opentui/solid */
import { TextAttributes, type BoxRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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
import { FilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { DialogVcsFiles } from "./dialog-vcs-files"
import { DialogVcsHunks } from "./dialog-vcs-hunks"

export type VcsViewController = Pick<
  ReturnType<typeof useVcs>,
  | "summary"
  | "refreshing"
  | "tool"
  | "refresh"
  | "openTool"
  | "openCommand"
  | "execute"
  | "patch"
  | "branches"
  | "history"
  | "show"
  | "switchTo"
  | "startChange"
  | "branchAction"
  | "hunks"
  | "applyHunks"
>

type VcsPane = "files" | "branches" | "history"
const panes = ["files", "branches", "history"] as const

export function VcsView(props: { onClose: () => void; controller?: VcsViewController }) {
  const vcs = props.controller ?? useVcs()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const toast = useToast()
  const keymap = Keymap.use()
  const [pane, setPane] = createSignal<VcsPane>("files")
  const [selected, setSelected] = createSignal(0)
  let sidebar: ScrollBoxRenderable | undefined
  let root: BoxRenderable | undefined
  onMount(() => {
    const timer = setTimeout(() => {
      if (root && !root.isDestroyed) root.focus()
    }, 1)
    onCleanup(() => clearTimeout(timer))
  })

  const current = () => vcs.summary()
  const kind = () => current()?.kind
  const files = createMemo(() => current()?.files ?? [])
  const file = createMemo(() => files().at(selected()))
  const [lists] = createResource(
    () => {
      const currentPane = pane()
      if (currentPane === "files" || !current()) return
      return { pane: currentPane, summary: current()! }
    },
    async (input) => {
      try {
        return input.pane === "branches" ? await vcs.branches() : await vcs.history()
      } catch {
        return []
      }
    },
  )
  const entries = createMemo<VcsListEntry[]>(() => (pane() === "files" ? [] : (lists() ?? [])))
  const entry = createMemo(() => entries().at(selected()))
  const previewLabel = () =>
    pane() === "files" ? (file()?.file ?? current()?.detail ?? "") : (entry()?.label ?? current()?.detail ?? "")
  const previewLabelWidth = () => Math.max(8, dimensions().width - sidebarWidth() - 36)
  const count = () => (pane() === "files" ? files().length : entries().length)
  const sidebarWidth = () => Math.max(30, Math.min(52, Math.floor(dimensions().width * 0.36)))
  const source = createMemo(() => {
    if (!current()) return
    if (pane() === "files") {
      const item = file()
      if (!item) return
      return { type: "file" as const, id: item.file, staged: item.staged && !item.unstaged }
    }
    const item = entry()
    if (!item) return
    return { type: "ref" as const, id: item.id }
  })
  const [diff] = createResource(source, async (input) => {
    try {
      return input.type === "file" ? await vcs.patch(input.id, input.staged) : await vcs.show(input.id)
    } catch {
      return ""
    }
  })
  const lines = createMemo(() => (diff() ?? "").split("\n").slice(0, 2_000))

  const status = (summary: VcsSummary) =>
    summary.conflict ? "conflict" : summary.dirty === 0 ? "clean" : `${summary.dirty} changed`

  createEffect(() => {
    setSelected((index) => Math.max(0, Math.min(index, Math.max(0, count() - 1))))
  })

  createEffect(() => {
    const index = selected()
    queueMicrotask(() => sidebar?.scrollTo(index))
  })

  const choosePane = (next: VcsPane) => {
    setPane(next)
    setSelected(0)
    queueMicrotask(() => sidebar?.scrollTo(0))
  }
  const cyclePane = (delta: number) => {
    const index = panes.indexOf(pane())
    choosePane(panes[(index + delta + panes.length) % panes.length]!)
  }
  const move = (delta: number) => {
    const total = count()
    if (total === 0) return
    setSelected((index) => Math.max(0, Math.min(total - 1, index + delta)))
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
  const switchReference = () => {
    const item = entry()
    if (!item) return
    const start = kind() === "jj" && item.immutable
    if (pane() === "history") {
      const noun = kind() === "jj" ? "change" : "commit"
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
            else void vcs.switchTo(item.id)
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
    void vcs.switchTo(item.id)
  }
  const deleteReference = () => {
    const repository = kind()
    const item = entry()
    if (!repository || !item || pane() !== "branches") return
    if (item.remote) {
      toast.show({ variant: "info", message: "Remote bookmarks are managed by jj git." })
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
    if (pane() === "branches") {
      promptBranch("create")
      return
    }
    const item = entry()
    if (pane() === "history" && item) promptBranch("create", { target: item.id })
  }
  const renameReference = () => {
    const item = entry()
    if (pane() !== "branches" || !item) return
    if (item.remote) {
      toast.show({ variant: "info", message: "Remote bookmarks are managed by jj git." })
      return
    }
    promptBranch("rename", { previous: item.label }, item.label)
  }
  const stageSelected = () => {
    const item = file()
    if (!item || kind() !== "git") return
    void vcs.execute(item.unstaged ? "stage" : "unstage", undefined, [item.file])
  }
  const openHunks = async (staged: boolean) => {
    const item = file()
    if (!item || kind() !== "git") return
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
      choosePane("files")
      return
    }
    if (key === "2") {
      handled()
      choosePane("branches")
      return
    }
    if (key === "3") {
      handled()
      choosePane("history")
      return
    }
    if (key === "tab" || key === "right") {
      handled()
      cyclePane(1)
      return
    }
    if (key === "left") {
      handled()
      cyclePane(-1)
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
    if (key === "home" || key === "g") {
      handled()
      setSelected(0)
      return
    }
    if (key === "end") {
      handled()
      setSelected(Math.max(0, count() - 1))
      return
    }
    if (key === "r") {
      handled()
      void vcs.refresh()
      return
    }
    if (key === "f" && repository) {
      handled()
      runAction("fetch")
      return
    }
    if (key === "p" && repository) {
      handled()
      runAction("push")
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
      if (pane() === "files") openDiff()
      else switchReference()
      return
    }
    if ((key === "space" || event.sequence === " ") && pane() === "files") {
      handled()
      stageSelected()
      return
    }
    if (key === "n") {
      handled()
      if (pane() === "files") {
        if (repository === "jj") runAction("new")
      } else createReference()
      return
    }
    if (key === "x" && pane() === "branches") {
      handled()
      deleteReference()
      return
    }
    if (key === "m" && pane() === "branches") {
      handled()
      renameReference()
      return
    }
    if (pane() !== "files") return
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
    return theme.text.muted
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
  const paneLabel = (item: VcsPane) =>
    item === "files" ? "files" : item === "branches" ? (kind() === "jj" ? "bookmarks" : "branches") : "history"
  const paneTitle = () =>
    pane() === "files" ? "Changes" : pane() === "branches" ? (kind() === "jj" ? "Bookmarks" : "Branches") : "History"
  const previewTitle = () => {
    if (pane() === "files") return "Diff"
    if (pane() === "branches") return kind() === "jj" ? "Bookmark details" : "Branch details"
    return kind() === "jj" ? "Change details" : "Commit details"
  }
  const referenceAction = () => (entry()?.immutable ? "new" : kind() === "jj" ? "edit" : "switch")
  const contextHints = (): Hint[] => {
    const repository = kind()
    if (pane() === "branches") {
      const local = !entry()?.remote
      return [
        { key: "enter", label: referenceAction() },
        { key: "n", label: "create" },
        ...(local
          ? [
              { key: "m", label: "rename" },
              { key: "x", label: "delete" },
            ]
          : []),
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
      ]
    }
    if (pane() === "history")
      return [
        { key: "enter", label: referenceAction() },
        { key: "n", label: repository === "jj" ? "bookmark at change" : "branch at commit" },
        { key: "f", label: "fetch" },
        { key: "p", label: "push" },
      ]
    if (repository === "git")
      return [
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
    { key: "1", label: "files" },
    { key: "2", label: paneLabel("branches") },
    { key: "3", label: "history" },
    ...(pane() === "files" ? [{ key: "enter", label: "diff" }] : []),
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
      <box
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.background.raised.base}
      >
        <text fg={theme.text.base} selectable={false}>
          <b>VCS</b>
        </text>
        <box flexGrow={1} minWidth={0}>
          <Show when={current()}>
            <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
              {`  ${current()!.kind} · ${current()!.label}`}
            </text>
          </Show>
        </box>
        <Show when={current()}>
          <text fg={current()!.conflict ? theme.text.feedback.error.base : theme.text.muted} selectable={false}>
            {`${status(current()!)}  `}
          </text>
        </Show>
        <text fg={theme.text.muted} selectable={false}>
          {vcs.refreshing() ? "refreshing…  " : ""}
        </text>
        <text fg={theme.text.muted} selectable={false}>
          esc close
        </text>
      </box>
      <box height={1} flexShrink={0} backgroundColor={theme.border.base} />
      <Show
        when={current()}
        fallback={
          <box flexGrow={1} paddingLeft={1} paddingTop={1}>
            <text fg={theme.text.muted}>No Git, jj, or Mercurial repository in this project.</text>
          </box>
        }
      >
        <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <box width={sidebarWidth()} flexShrink={0} flexDirection="column" gap={1}>
            <box
              flexGrow={1}
              minHeight={0}
              border
              borderColor={theme.background.action.primary.focused}
              title={`${paneTitle()} · ${count()}`}
              titleColor={theme.text.base}
              backgroundColor={theme.background.raised.base}
            >
              <box height={1} flexDirection="row" paddingLeft={1} gap={2}>
                <For each={panes}>
                  {(item) => (
                    <text
                      fg={pane() === item ? theme.text.base : theme.text.muted}
                      attributes={pane() === item ? TextAttributes.BOLD : undefined}
                      selectable={false}
                      onMouseUp={() => choosePane(item)}
                    >
                      {paneLabel(item)}
                    </text>
                  )}
                </For>
              </box>
              <scrollbox ref={(node) => (sidebar = node)} flexGrow={1} scrollbarOptions={{ visible: true }}>
                <Show
                  when={pane() === "files"}
                  fallback={
                    <Show
                      when={!lists.loading}
                      fallback={
                        <box height={1} paddingLeft={2}>
                          <text fg={theme.text.muted} selectable={false}>
                            Loading…
                          </text>
                        </box>
                      }
                    >
                      <Show
                        when={entries().length > 0}
                        fallback={
                          <box height={1} paddingLeft={2}>
                            <text fg={theme.text.muted} selectable={false}>
                              {pane() === "branches"
                                ? kind() === "jj"
                                  ? "no bookmarks"
                                  : "no branches"
                                : "no history"}
                            </text>
                          </box>
                        }
                      >
                        <For each={entries()}>
                          {(item, index) => {
                            const active = () => selected() === index()
                            return (
                              <box
                                height={1}
                                flexDirection="row"
                                paddingLeft={1}
                                paddingRight={1}
                                backgroundColor={active() ? theme.background.action.primary.focused : undefined}
                                onMouseUp={() => setSelected(index())}
                              >
                                <text fg={theme.text.muted} width={2} selectable={false}>
                                  {item.current ? "*" : " "}
                                </text>
                                <text
                                  fg={active() ? theme.text.base : theme.text.muted}
                                  wrapMode="none"
                                  selectable={false}
                                >
                                  {Locale.truncateWidth(item.label, sidebarWidth() - 15)}
                                </text>
                                <box flexGrow={1} />
                                <text fg={theme.text.muted} selectable={false}>
                                  {Locale.truncateWidth(item.detail?.split(" · ")[0] ?? "", 8)}
                                </text>
                              </box>
                            )
                          }}
                        </For>
                      </Show>
                    </Show>
                  }
                >
                  <Show
                    when={files().length > 0}
                    fallback={
                      <box height={1} paddingLeft={2}>
                        <text fg={theme.text.muted} selectable={false}>
                          clean
                        </text>
                      </box>
                    }
                  >
                    <For each={files()}>
                      {(item, index) => {
                        const active = () => selected() === index()
                        return (
                          <box
                            height={1}
                            flexDirection="row"
                            paddingLeft={2}
                            paddingRight={1}
                            backgroundColor={active() ? theme.background.action.primary.focused : undefined}
                            onMouseUp={() => setSelected(index())}
                          >
                            <text fg={markerColor(item)} selectable={false}>
                              {marker(item)}
                            </text>
                            <box width={1} />
                            <FilePath
                              value={item.file}
                              maxWidth={sidebarWidth() - 9}
                              fg={active() ? theme.text.base : theme.text.muted}
                            />
                            <box flexGrow={1} />
                            <Show when={item.staged}>
                              <text fg={theme.text.muted} selectable={false}>
                                +
                              </text>
                            </Show>
                          </box>
                        )
                      }}
                    </For>
                  </Show>
                </Show>
              </scrollbox>
            </box>
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
              <text fg={theme.text.muted} selectable={false}>
                {pane() === "files"
                  ? kind() === "git" && file()
                    ? file()!.staged && !file()!.unstaged
                      ? "staged"
                      : "unstaged"
                    : ""
                  : Locale.truncateWidth(
                      entry()?.detail ??
                        (pane() === "branches"
                          ? kind() === "jj"
                            ? "bookmark"
                            : "branch"
                          : kind() === "jj"
                            ? "change"
                            : "commit"),
                      24,
                    )}
              </text>
            </box>
            <Show
              when={pane() === "files" ? file() : entry()}
              fallback={
                <box paddingLeft={1} paddingTop={1}>
                  <text fg={theme.text.muted} selectable={false}>
                    {pane() === "files"
                      ? current()?.detail || "No changes"
                      : pane() === "branches"
                        ? kind() === "jj"
                          ? "No bookmarks"
                          : "No branches"
                        : "No history"}
                  </text>
                  <Show when={current()?.change}>
                    <text fg={theme.text.muted} selectable={false}>
                      {`change ${current()!.change}${current()!.commit ? ` · commit ${current()!.commit}` : ""}`}
                    </text>
                  </Show>
                </box>
              }
            >
              <Show
                when={!diff.loading}
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
                        {pane() === "files" ? "No diff for this file." : "No details for this entry."}
                      </text>
                    </box>
                  }
                >
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
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
