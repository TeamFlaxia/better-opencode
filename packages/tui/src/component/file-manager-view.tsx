/** @jsxImportSource @opentui/solid */
import { TextAttributes, type BoxRenderable, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import path from "node:path"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useFileManager } from "../context/file-manager"
import { useTheme } from "../context/theme"
import { errorMessage } from "../util/error"
import { formatFileSize, type FileManagerEntry, type FileManagerPreview } from "../util/file-manager"
import { Locale } from "../util/locale"
import { useDialog } from "../ui/dialog"
import { FilePath } from "../ui/file-path"
import { revealSelectionOffset } from "../ui/select-controller"
import { useToast } from "../ui/toast"

type FileManagerPanel = "list" | "preview"

type FileManagerRow =
  | { readonly kind: "parent" }
  | { readonly kind: "entry"; readonly entry: FileManagerEntry }

type PreviewState =
  | { readonly type: "none" }
  | { readonly type: "directory" }
  | { readonly type: "loading" }
  | { readonly type: "binary"; readonly preview: FileManagerPreview }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "text"; readonly preview: FileManagerPreview }

type PreviewResult =
  | { readonly key: string; readonly preview: FileManagerPreview; readonly error?: undefined }
  | { readonly key: string; readonly error: string; readonly preview?: undefined }

export type FileManagerController = Pick<
  ReturnType<typeof useFileManager>,
  "root" | "path" | "entries" | "loading" | "error" | "revision" | "open" | "up" | "refresh" | "preview"
>

export function FileManagerView(props: { onClose: () => void; controller?: FileManagerController }) {
  const fileManager = props.controller ?? useFileManager()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()
  const [focus, setFocus] = createSignal<FileManagerPanel>("list")
  const [selection, setSelection] = createSignal(0)
  const scrolls: Partial<Record<FileManagerPanel, ScrollBoxRenderable>> = {}
  let root: BoxRenderable | undefined
  onMount(() => {
    const timer = setTimeout(() => {
      if (root && !root.isDestroyed) root.focus()
    }, 1)
    onCleanup(() => clearTimeout(timer))
  })

  const rows = createMemo<FileManagerRow[]>(() => [
    ...(fileManager.path() ? [{ kind: "parent" as const }] : []),
    ...fileManager.entries().map((entry) => ({ kind: "entry" as const, entry })),
  ])
  const selectedRow = createMemo(() => rows().at(selection()))
  const selectedEntry = createMemo(() => {
    const row = selectedRow()
    return row?.kind === "entry" ? row.entry : undefined
  })
  const selectedFile = createMemo(() => {
    const entry = selectedEntry()
    return entry?.type === "file" ? entry : undefined
  })
  const previewSource = createMemo(() => {
    const entry = selectedFile()
    if (!entry) return undefined
    return { path: entry.path, revision: fileManager.revision() }
  })
  const [preview] = createResource(previewSource, async (input): Promise<PreviewResult> => {
    const key = `${input.path}:${input.revision}`
    try {
      return { key, preview: await fileManager.preview(input.path) }
    } catch (cause) {
      return { key, error: errorMessage(cause) }
    }
  })
  const previewResult = () => {
    const source = previewSource()
    if (!source) return undefined
    const key = `${source.path}:${source.revision}`
    const current = preview()
    if (current?.key === key) return current
    const latest = preview.latest
    if (latest?.key === key) return latest
    return undefined
  }
  const previewLoading = () => previewSource() !== undefined && preview.loading && previewResult() === undefined
  const lines = createMemo(() => previewResult()?.preview?.text.split("\n") ?? [])
  const previewState = createMemo<PreviewState>(() => {
    const entry = selectedEntry()
    if (!entry) return { type: "none" }
    if (entry.type === "directory") return { type: "directory" }
    if (previewLoading()) return { type: "loading" }
    const result = previewResult()
    if (!result) return { type: "loading" }
    if (result.error) return { type: "error", message: result.error }
    if (!result.preview) return { type: "loading" }
    if (result.preview.binary) return { type: "binary", preview: result.preview }
    return { type: "text", preview: result.preview }
  })
  const rootName = () => {
    const value = fileManager.root()
    if (!value) return ""
    const trimmed = value.replace(/[\\/]+$/, "")
    const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
    return trimmed.slice(index + 1) || value
  }
  const breadcrumb = () => {
    const current = fileManager.path()
    return current ? path.join(rootName(), current) : rootName()
  }
  const sidebarWidth = () => Math.max(24, Math.min(44, Math.floor(dimensions().width * 0.36)))
  const previewLabelWidth = () => Math.max(8, dimensions().width - sidebarWidth() - 34)
  const previewLabel = () => selectedEntry()?.path ?? "Select a file to preview"
  const previewDetail = () => {
    const state = previewState()
    if (state.type === "binary" || state.type === "text")
      return `${formatFileSize(state.preview.bytes)}${state.preview.truncated ? " · truncated" : ""}`
    if (state.type === "directory") return "directory"
    return ""
  }
  const previewDetailColor = () => {
    const state = previewState()
    if (state.type === "error") return theme.text.feedback.error.base
    if ((state.type === "binary" || state.type === "text") && state.preview.truncated)
      return theme.text.feedback.warning.base
    return theme.text.muted
  }
  const previewBytes = () => {
    const state = previewState()
    return state.type === "binary" ? state.preview.bytes : 0
  }
  const previewError = () => {
    const state = previewState()
    return state.type === "error" ? state.message : ""
  }
  const gutter = () => String(Math.max(1, lines().length)).length + 1

  createEffect(() => {
    const total = rows().length
    setSelection((value) => Math.min(value, Math.max(0, total - 1)))
  })

  createEffect(
    on(
      () => fileManager.path(),
      () => {
        setSelection(0)
        setFocus("list")
        queueMicrotask(() => scrolls.preview?.scrollTo(0))
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const index = selection()
    queueMicrotask(() => {
      const scroll = scrolls.list
      if (!scroll) return
      const limit = scroll.viewport.height
      if (limit <= 0) return
      const offset = revealSelectionOffset(scroll.scrollTop, {
        count: rows().length,
        limit,
        selected: index,
      })
      if (offset !== scroll.scrollTop) scroll.scrollTo(offset)
    })
  })

  const move = (delta: number) => {
    if (focus() === "preview") {
      scrollPreview(delta)
      return
    }
    const total = rows().length
    if (total === 0) return
    setSelection((value) => Math.max(0, Math.min(total - 1, value + delta)))
  }
  const scrollPreview = (delta: number) => {
    const scroll = scrolls.preview
    if (!scroll) return
    const limit = Math.max(1, scroll.viewport.height)
    const max = Math.max(0, lines().length - limit)
    scroll.scrollTo(Math.max(0, Math.min(max, scroll.scrollTop + delta)))
  }
  const pageSize = () => Math.max(1, (scrolls[focus()]?.viewport.height ?? 1) - 1)
  const first = () => {
    if (focus() === "preview") return scrolls.preview?.scrollTo(0)
    setSelection(0)
  }
  const last = () => {
    if (focus() === "preview") {
      const scroll = scrolls.preview
      if (!scroll) return
      scroll.scrollTo(Math.max(0, lines().length - Math.max(1, scroll.viewport.height)))
      return
    }
    setSelection(Math.max(0, rows().length - 1))
  }
  const goUp = () => {
    if (!fileManager.path()) return
    void fileManager.up()
  }
  const openSelected = () => {
    if (selectedRow()?.kind === "parent") {
      goUp()
      return
    }
    const entry = selectedEntry()
    if (!entry) return
    if (entry.type === "directory") {
      void fileManager.open(entry.path)
      return
    }
    setFocus("preview")
  }
  const copyPath = () => {
    const entry = selectedEntry()
    const root = fileManager.root()
    if (!entry || !root) return
    void clipboard
      .write(path.resolve(root, entry.path))
      .then(() => toast.show({ variant: "info", message: "Path copied" }))
      .catch(toast.error)
  }

  useKeyboard((event) => {
    if (dialog.stack.length > 0) return
    if (event.ctrl || event.meta || event.option || event.super || event.hyper || event.shift) return
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
    if (key === "tab") {
      handled()
      setFocus((value) => (value === "list" ? "preview" : "list"))
      return
    }
    if (key === "left") {
      handled()
      setFocus("list")
      return
    }
    if (key === "right") {
      handled()
      setFocus("preview")
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
    if (key === "pageup") {
      handled()
      move(-pageSize())
      return
    }
    if (key === "pagedown") {
      handled()
      move(pageSize())
      return
    }
    if (key === "home" || key === "g") {
      handled()
      first()
      return
    }
    if (key === "end") {
      handled()
      last()
      return
    }
    if (key === "enter" || key === "return") {
      handled()
      openSelected()
      return
    }
    if (key === "backspace" || key === "h") {
      handled()
      goUp()
      return
    }
    if (key === "r") {
      handled()
      void fileManager.refresh()
      return
    }
    if (key === "y") {
      handled()
      copyPath()
      return
    }
  })

  const rowBackground = (index: number) => {
    if (selection() !== index) return undefined
    return focus() === "list" ? theme.background.action.primary.focused : theme.background.raised.high
  }
  const rowColor = (index: number, color: RGBA) => {
    if (selection() !== index) return color
    return focus() === "list" ? theme.text.action.primary.focused : theme.text.base
  }
  const marker = (row: FileManagerRow) => (row.kind === "parent" ? ".." : row.entry.type === "directory" ? "▸" : " ")
  const markerColor = (row: FileManagerRow) =>
    row.kind === "parent" || row.entry.type === "directory" ? theme.text.feedback.info.base : theme.text.muted
  const rowEntry = (row: FileManagerRow) => (row.kind === "entry" ? row.entry : undefined)
  const emptyList = () => {
    if (fileManager.loading()) return "Loading…"
    if (fileManager.error()) return "Could not read this directory"
    return "Empty directory"
  }
  const emptyRow = (message: string) => (
    <box height={1} paddingLeft={1}>
      <text fg={theme.text.muted} selectable={false}>
        {message}
      </text>
    </box>
  )
  type Hint = { readonly key: string; readonly label: string }
  const contextHints = (): Hint[] => {
    if (focus() === "preview")
      return [
        { key: "up", label: "scroll" },
        { key: "y", label: "copy path" },
      ]
    return [
      { key: "enter", label: selectedEntry()?.type === "directory" ? "open" : "preview" },
      ...(fileManager.path() ? [{ key: "backspace", label: "up" }] : []),
      { key: "y", label: "copy path" },
    ]
  }
  const globalHints = (): Hint[] => [
    { key: "tab", label: "pane" },
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
      <box height={3} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box height={1} flexDirection="row" gap={1}>
          <text fg={theme.text.base} selectable={false}>
            <b>File manager</b>
          </text>
          <text fg={theme.text.feedback.info.base} selectable={false}>
            {rootName()}
          </text>
          <box flexGrow={1} minWidth={0} />
          <text fg={theme.text.muted} selectable={false}>
            {fileManager.loading() ? "loading…" : `${fileManager.entries().length} entries`}
          </text>
        </box>
        <box height={1} flexDirection="row" gap={1}>
          <box flexGrow={1} minWidth={0}>
            <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
              {Locale.truncateWidth(breadcrumb(), Math.max(8, dimensions().width - 2))}
            </text>
          </box>
          <Show when={fileManager.error()}>
            <text fg={theme.text.feedback.error.base} wrapMode="none" truncate selectable={false}>
              {Locale.truncateWidth(fileManager.error()!, 32)}
            </text>
          </Show>
        </box>
      </box>
      <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <box
          width={sidebarWidth()}
          flexShrink={0}
          minHeight={0}
          border
          borderColor={focus() === "list" ? theme.background.action.primary.focused : theme.border.base}
          title={`Directory · ${fileManager.entries().length}`}
          titleColor={focus() === "list" ? theme.text.base : theme.text.muted}
          backgroundColor={theme.background.raised.base}
          onMouseDown={() => setFocus("list")}
        >
          <scrollbox
            ref={(node) => (scrolls.list = node)}
            flexGrow={1}
            scrollX={false}
            verticalScrollbarOptions={{ visible: true }}
          >
            <Show when={rows().length > 0} fallback={emptyRow(emptyList())}>
              <Index each={rows()}>
                {(row, index) => (
                  <box
                    height={1}
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={rowBackground(index)}
                    onMouseUp={() => {
                      setFocus("list")
                      setSelection(index)
                    }}
                  >
                    <text
                      fg={rowColor(index, markerColor(row()))}
                      width={3}
                      selectable={false}
                      attributes={rowEntry(row())?.type === "directory" ? TextAttributes.BOLD : undefined}
                    >
                      {marker(row())}
                    </text>
                    <Show
                      when={rowEntry(row()) !== undefined}
                      fallback={
                        <text fg={rowColor(index, theme.text.muted)} selectable={false}>
                          parent
                        </text>
                      }
                    >
                      <Show
                        when={rowEntry(row())?.type === "directory"}
                        fallback={
                          <FilePath
                            value={rowEntry(row())?.name ?? ""}
                            maxWidth={sidebarWidth() - 8}
                            fg={rowColor(index, theme.text.base)}
                          />
                        }
                      >
                        <text
                          fg={rowColor(index, theme.text.base)}
                          attributes={TextAttributes.BOLD}
                          wrapMode="none"
                          selectable={false}
                        >
                          {Locale.truncateWidth(rowEntry(row())?.name ?? "", Math.max(1, sidebarWidth() - 8))}
                        </text>
                      </Show>
                    </Show>
                    <box flexGrow={1} />
                    <Show when={rowEntry(row())?.type === "directory"}>
                      <text fg={rowColor(index, theme.text.muted)} selectable={false}>
                        /
                      </text>
                    </Show>
                  </box>
                )}
              </Index>
            </Show>
          </scrollbox>
        </box>
        <box
          flexGrow={1}
          minWidth={0}
          minHeight={0}
          border
          borderColor={focus() === "preview" ? theme.background.action.primary.focused : theme.border.base}
          title="Preview"
          titleColor={focus() === "preview" ? theme.text.base : theme.text.muted}
          backgroundColor={theme.background.raised.base}
          onMouseDown={() => setFocus("preview")}
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
          <Switch>
            <Match when={previewState().type === "text"}>
              <scrollbox
                ref={(node) => (scrolls.preview = node)}
                flexGrow={1}
                scrollX={false}
                verticalScrollbarOptions={{ visible: true }}
              >
                <box flexDirection="column" paddingLeft={1}>
                  <For each={lines()}>
                    {(line, index) => (
                      <box height={1} flexDirection="row">
                        <text width={Math.max(1, gutter() - 1)} fg={theme.text.muted} selectable={false}>
                          {String(index() + 1).padStart(Math.max(1, gutter() - 1))}
                        </text>
                        <box width={1} />
                        <text fg={theme.text.base} wrapMode="none" selectable={false}>
                          {line || " "}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </scrollbox>
            </Match>
            <Match when={previewState().type === "binary"}>
              <box paddingLeft={1} paddingTop={1} flexDirection="column">
                <text fg={theme.text.muted} selectable={false}>
                  Binary file
                </text>
                <text fg={theme.text.muted} selectable={false}>
                  {formatFileSize(previewBytes())}
                </text>
              </box>
            </Match>
            <Match when={previewState().type === "error"}>
              <box paddingLeft={1} paddingTop={1}>
                <text fg={theme.text.feedback.error.base} selectable={false}>
                  {previewError()}
                </text>
              </box>
            </Match>
            <Match when={previewState().type === "loading"}>
              <box paddingLeft={1} paddingTop={1}>
                <text fg={theme.text.muted}>Loading…</text>
              </box>
            </Match>
            <Match when={previewState().type !== "text"}>
              <box paddingLeft={1} paddingTop={1} flexDirection="column">
                <text fg={theme.text.muted} selectable={false}>
                  {previewState().type === "directory" ? "Directory selected · enter to open" : "Select a file to preview"}
                </text>
              </box>
            </Match>
          </Switch>
        </box>
      </box>
      <box height={2} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        {hintRow(contextHints())}
        {hintRow(globalHints())}
      </box>
    </box>
  )
}
