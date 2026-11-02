/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useVcs } from "../context/vcs"
import { errorMessage } from "../util/error"
import { type VcsFile, type VcsKind, type VcsMutation, type VcsSummary } from "../util/vcs"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { FilePath } from "../ui/file-path"
import { useToast } from "../ui/toast"
import { DialogVcsFiles } from "./dialog-vcs-files"
import { DialogVcsHunks } from "./dialog-vcs-hunks"

export type VcsViewController = Pick<
  ReturnType<typeof useVcs>,
  | "summaries"
  | "summary"
  | "refreshing"
  | "tool"
  | "refresh"
  | "openTool"
  | "openCommand"
  | "execute"
  | "patch"
  | "hunks"
  | "applyHunks"
>

export function VcsView(props: { onClose: () => void; controller?: VcsViewController }) {
  const vcs = props.controller ?? useVcs()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const toast = useToast()
  const keymap = Keymap.use()
  const [activeKind, setActiveKind] = createSignal<VcsKind>()
  const [selected, setSelected] = createSignal(0)
  let sidebar: ScrollBoxRenderable | undefined
  let root: BoxRenderable | undefined
  onMount(() => {
    const timer = setTimeout(() => {
      if (root && !root.isDestroyed) root.focus()
    }, 1)
    onCleanup(() => clearTimeout(timer))
  })

  const summaries = () => vcs.summaries()
  const active = createMemo(() => summaries().find((summary) => summary.kind === activeKind()) ?? summaries().at(0))
  const files = createMemo(() => active()?.files ?? [])
  const file = createMemo(() => files().at(selected()))
  const sidebarWidth = () => Math.max(28, Math.min(48, Math.floor(dimensions().width * 0.34)))
  const source = createMemo(() => {
    const summary = active()
    const item = file()
    if (!summary || !item) return
    return { kind: summary.kind, file: item.file, staged: item.staged && !item.unstaged }
  })
  const [diff] = createResource(source, async (input) => {
    try {
      return await vcs.patch(input.kind, input.file, input.staged)
    } catch {
      return ""
    }
  })
  const lines = createMemo(() => (diff() ?? "").split("\n").slice(0, 2_000))

  const status = (summary: VcsSummary) =>
    summary.conflict ? "conflict" : summary.dirty === 0 ? "clean" : `${summary.dirty} changed`

  const offsetFor = (kind: VcsKind, index: number) => {
    let offset = 0
    for (const summary of summaries()) {
      if (summary.kind === kind) return offset + 1 + index
      offset += 1 + Math.max(1, summary.files.length) + 1
    }
    return offset
  }

  createEffect(() => {
    const kinds = summaries().map((summary) => summary.kind)
    if (kinds.length === 0) {
      setActiveKind(undefined)
      setSelected(0)
      return
    }
    if (!activeKind() || !kinds.includes(activeKind()!)) {
      setActiveKind(kinds[0])
      setSelected(0)
      return
    }
    setSelected((index) => Math.max(0, Math.min(index, Math.max(0, files().length - 1))))
  })

  createEffect(() => {
    const kind = activeKind()
    if (!kind) return
    const offset = offsetFor(kind, selected())
    queueMicrotask(() => sidebar?.scrollTo(offset))
  })

  const selectKind = (kind: VcsKind) => {
    setActiveKind(kind)
    setSelected(0)
  }
  const move = (delta: number) => {
    if (files().length === 0) return
    setSelected((index) => Math.max(0, Math.min(files().length - 1, index + delta)))
  }
  const cycleKind = (delta: number) => {
    const kinds = summaries().map((summary) => summary.kind)
    if (kinds.length < 2) return
    const index = kinds.indexOf(activeKind() ?? kinds[0]!)
    selectKind(kinds[(index + delta + kinds.length) % kinds.length]!)
  }

  const prompt = (
    title: string,
    placeholder: string,
    value: string,
    action: VcsMutation,
    kind: VcsKind,
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
          void vcs.execute(action, next, paths, kind)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const confirm = (title: string, message: string, action: VcsMutation, kind: VcsKind) => {
    dialog.replace(() => (
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => {
          dialog.clear()
          void vcs.execute(action, undefined, [], kind)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const stageSelected = () => {
    const item = file()
    const current = active()
    if (!item || current?.kind !== "git") return
    void vcs.execute(item.unstaged ? "stage" : "unstage", undefined, [item.file], "git")
  }
  const openHunks = async (staged: boolean) => {
    const item = file()
    if (!item || active()?.kind !== "git") return
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
    const current = active()
    if (current?.kind !== "jj" || current.files.length === 0) return
    const paths = await DialogVcsFiles.show(dialog, {
      title: parallel ? "Split files into parallel change" : "Split files into new change",
      description: "Select the files that move into the new change.",
      confirmLabel: "split",
      files: current.files,
    })
    if (!paths?.length) return
    prompt(
      "Split description",
      "Description for the new change",
      "",
      parallel ? "split_parallel" : "split",
      "jj",
      paths,
    )
  }
  const openExternal = () => {
    const kind = active()?.kind
    props.onClose()
    void vcs.openTool(kind)
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
    const kind = active()?.kind
    if (!kind) return
    void vcs.execute(action, undefined, [], kind)
  }

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    const kind = active()?.kind
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
    if (key === "tab" || key === "right") {
      handled()
      cycleKind(1)
      return
    }
    if (key === "left") {
      handled()
      cycleKind(-1)
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
      setSelected(Math.max(0, files().length - 1))
      return
    }
    if (key === "r") {
      handled()
      void vcs.refresh()
      return
    }
    if (key === "o") {
      handled()
      openExternal()
      return
    }
    if (key === "enter") {
      handled()
      openDiff()
      return
    }
    if (key === "space" || event.sequence === " ") {
      handled()
      stageSelected()
      return
    }
    if (key === "c" && kind === "git") {
      handled()
      prompt("Commit staged changes", "Commit message", "", "commit", "git")
      return
    }
    if (key === "a" && (kind === "git" || kind === "jj")) {
      handled()
      if (kind === "git") prompt("Commit all changes", "Commit message", "", "commit_all", "git")
      else confirm("Abandon change?", "The current change and its description will be abandoned.", "abandon", "jj")
      return
    }
    if (key === "d" && kind === "jj") {
      handled()
      prompt("Describe change", "Change description", active()?.description ?? "", "describe", "jj")
      return
    }
    if (key === "n" && kind === "jj") {
      handled()
      runAction("new")
      return
    }
    if (key === "s" && kind === "jj") {
      handled()
      runAction("squash")
      return
    }
    if (key === "b" && kind === "jj") {
      handled()
      prompt("Set bookmark", "Bookmark name", "", "bookmark", "jj")
      return
    }
    if (key === "e" && kind === "jj") {
      handled()
      prompt("Edit change", "Revset", "@-", "edit", "jj")
      return
    }
    if (key === "v" && kind === "jj") {
      handled()
      void splitFiles(false)
      return
    }
    if (key === "w" && kind === "jj") {
      handled()
      void splitFiles(true)
      return
    }
    if (key === "i" && kind === "jj") {
      handled()
      openInteractiveSplit()
      return
    }
    if (key === "h" && kind === "git") {
      handled()
      void openHunks(false)
      return
    }
    if (key === "u" && kind === "git") {
      handled()
      void openHunks(true)
      return
    }
    if (key === "f" && kind) {
      handled()
      runAction("fetch")
      return
    }
    if (key === "p" && kind) {
      handled()
      runAction("push")
      return
    }
    if (key === "l" && kind === "git") {
      handled()
      runAction("pull")
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
  const hint = () => {
    const kind = active()?.kind
    const shared = "r refresh  o external  enter diff  q close"
    if (kind === "jj")
      return `d describe  n new  s squash  b bookmark  a abandon  e edit  f fetch  p push  v/w split  i interactive  ${shared}`
    if (kind === "git") return `space stage  c commit  a commit all  h/u hunks  f fetch  p push  l pull  ${shared}`
    return shared
  }

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
          <b>Version control</b>
        </text>
        <Show when={summaries().length > 1}>
          <text fg={theme.text.muted} selectable={false}>
            {` · ${summaries()
              .map((summary) => summary.kind)
              .join(" + ")}`}
          </text>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.text.muted} selectable={false}>
          {vcs.refreshing() ? "refreshing…" : ""}
        </text>
      </box>
      <Show
        when={summaries().length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={1} paddingTop={1}>
            <text fg={theme.text.muted}>No Git, jj, or Mercurial repository in this project.</text>
          </box>
        }
      >
        <box flexGrow={1} minHeight={0} flexDirection="row">
          <box
            width={sidebarWidth()}
            flexShrink={0}
            flexDirection="column"
            backgroundColor={theme.background.raised.base}
          >
            <scrollbox ref={(node) => (sidebar = node)} flexGrow={1} scrollbarOptions={{ visible: false }}>
              <For each={summaries()}>
                {(summary) => (
                  <>
                    <box
                      height={1}
                      flexDirection="row"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={
                        active()?.kind === summary.kind ? theme.background.raised.high : theme.background.raised.base
                      }
                      onMouseUp={() => selectKind(summary.kind)}
                    >
                      <text fg={theme.text.base} selectable={false}>
                        <b>{summary.kind}</b>
                      </text>
                      <text fg={theme.text.muted} selectable={false}>
                        {` ${summary.label}`}
                      </text>
                      <box flexGrow={1} />
                      <text
                        fg={summary.conflict ? theme.text.feedback.error.base : theme.text.muted}
                        selectable={false}
                      >
                        {status(summary)}
                      </text>
                    </box>
                    <Show
                      when={summary.files.length > 0}
                      fallback={
                        <box height={1} paddingLeft={2}>
                          <text fg={theme.text.muted} selectable={false}>
                            clean
                          </text>
                        </box>
                      }
                    >
                      <For each={summary.files}>
                        {(item, index) => {
                          const current = () => active()?.kind === summary.kind && selected() === index()
                          return (
                            <box
                              height={1}
                              flexDirection="row"
                              paddingLeft={2}
                              paddingRight={1}
                              backgroundColor={current() ? theme.background.action.primary.focused : undefined}
                              onMouseUp={() => {
                                setActiveKind(summary.kind)
                                setSelected(index())
                              }}
                            >
                              <text fg={markerColor(item)} selectable={false}>
                                {marker(item)}
                              </text>
                              <box width={1} />
                              <FilePath
                                value={item.file}
                                maxWidth={sidebarWidth() - 6}
                                fg={current() ? theme.text.base : theme.text.muted}
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
                    <box height={1} />
                  </>
                )}
              </For>
            </scrollbox>
          </box>
          <box flexGrow={1} minWidth={0} flexDirection="column">
            <box
              height={1}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.background.raised.base}
            >
              <text fg={theme.text.base} selectable={false}>
                <b>{active()?.kind ?? "vcs"}</b>
              </text>
              <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                {` ${file()?.file ?? active()?.detail ?? ""}`}
              </text>
              <box flexGrow={1} />
              <text fg={theme.text.muted} selectable={false}>
                {file() ? (file()!.staged && !file()!.unstaged ? "staged" : "unstaged") : ""}
              </text>
            </box>
            <Show
              when={file()}
              fallback={
                <box paddingLeft={1} paddingTop={1}>
                  <text fg={theme.text.muted} selectable={false}>
                    {active()?.detail || "No changes"}
                  </text>
                  <Show when={active()?.change}>
                    <text fg={theme.text.muted} selectable={false}>{`change ${active()?.change}`}</text>
                  </Show>
                </box>
              }
            >
              <Show
                when={!diff.loading}
                fallback={
                  <box paddingLeft={1} paddingTop={1}>
                    <text fg={theme.text.muted}>Loading diff…</text>
                  </box>
                }
              >
                <Show
                  when={lines().length > 0 && lines()[0] !== ""}
                  fallback={
                    <box paddingLeft={1} paddingTop={1}>
                      <text fg={theme.text.muted}>No diff for this file.</text>
                    </box>
                  }
                >
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
                    <For each={lines()}>
                      {(line) => (
                        <text fg={diffColor(line)} wrapMode="none" selectable={false}>
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
        height={1}
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.background.raised.base}
      >
        <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
          {hint()}
        </text>
      </box>
    </box>
  )
}
