import { type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { FilePath } from "../ui/file-path"
import {
  DIALOG_INSET,
  DialogBleed,
  dialogWidth,
  DialogHeader,
  DialogLayout,
  useDialog,
  type DialogContext,
} from "../ui/dialog"
import type { VcsFile } from "../util/vcs"
import { getScrollAcceleration } from "../util/scroll"
import { revealSelectionOffset } from "../ui/select-controller"

function statusLabel(status: VcsFile["status"]) {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  return "M"
}

export function DialogVcsFiles(props: {
  title: string
  description?: string
  confirmLabel?: string
  files: readonly VcsFile[]
  onConfirm: (paths: string[]) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const config = useConfig().data
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const [store, setStore] = createStore({
    index: 0,
    selected: {} as Record<string, boolean>,
  })
  const height = createMemo(() => Math.max(1, Math.min(props.files.length, 12)))
  const nameWidth = createMemo(() => Math.max(8, dialogWidth("medium") - DIALOG_INSET * 2 - 6))
  let scroll: ScrollBoxRenderable | undefined
  const selected = () => props.files.filter((file) => store.selected[file.file]).map((file) => file.file)
  const toggle = (file: string) => setStore("selected", file, !store.selected[file])
  const move = (delta: number) => {
    const index = Math.max(0, Math.min(props.files.length - 1, store.index + delta))
    setStore("index", index)
    queueMicrotask(() => {
      if (!scroll) return
      const offset = revealSelectionOffset(scroll.scrollTop, {
        count: props.files.length,
        limit: height(),
        selected: index,
      })
      if (offset !== scroll.scrollTop) scroll.scrollTo(offset)
    })
  }
  const confirm = () => {
    const paths = selected()
    if (paths.length === 0) {
      const file = props.files[store.index]?.file
      if (!file) return
      paths.push(file)
    }
    props.onConfirm(paths)
    dialog.clear()
  }
  useKeyboard((event) => {
    if (event.name === "up" || event.name === "k") {
      event.preventDefault()
      event.stopPropagation()
      move(-1)
      return
    }
    if (event.name === "down" || event.name === "j") {
      event.preventDefault()
      event.stopPropagation()
      move(1)
      return
    }
    if (event.name === "space" || event.sequence === " ") {
      event.preventDefault()
      event.stopPropagation()
      const file = props.files[store.index]?.file
      if (file) toggle(file)
      return
    }
    if (event.name === "a") {
      event.preventDefault()
      event.stopPropagation()
      const all = props.files.every((file) => store.selected[file.file])
      setStore("selected", all ? {} : Object.fromEntries(props.files.map((file) => [file.file, true])))
      return
    }
    if (event.name !== "return") return
    event.preventDefault()
    event.stopPropagation()
    confirm()
  })

  return (
    <DialogLayout
      header={<DialogHeader title={props.title} onClose={props.onCancel} />}
      footer={{
        actions: {
          primary: [
            {
              title: "toggle",
              key: "space",
              onTrigger: () => {
                const file = props.files[store.index]?.file
                if (file) toggle(file)
              },
            },
            { title: props.confirmLabel ?? "confirm", key: "enter", onTrigger: confirm },
          ],
          secondary: [{ title: "cancel", key: "esc", onTrigger: props.onCancel }],
        },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end" gap={1}>
          <text fg={theme.text.muted}>space toggle · a all · enter confirm · esc cancel</text>
        </box>
      }
    >
      <box gap={1}>
        <text fg={theme.text.muted} wrapMode="word">
          {props.description ?? "Select files with space, then confirm."}
        </text>
        <DialogBleed>
          <scrollbox
            ref={(value) => (scroll = value)}
            height={height()}
            backgroundColor={overlay.background.raised.high}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
          >
            <For each={props.files}>
              {(file, index) => (
                <box
                  flexDirection="row"
                  paddingLeft={DIALOG_INSET}
                  paddingRight={DIALOG_INSET}
                  backgroundColor={index() === store.index ? overlay.background.action.primary.focused : undefined}
                  onMouseUp={() => {
                    setStore("index", index())
                    toggle(file.file)
                  }}
                >
                  <box width={2} flexShrink={0}>
                    <text
                      fg={
                        index() === store.index
                          ? overlay.text.action.primary.focused
                          : store.selected[file.file]
                            ? theme.text.base
                            : theme.text.muted
                      }
                    >
                      {store.selected[file.file] ? "x" : " "}
                    </text>
                  </box>
                  <box width={2} flexShrink={0}>
                    <text
                      fg={
                        index() === store.index
                          ? overlay.text.action.primary.focused
                          : file.conflict
                            ? theme.text.feedback.error.base
                            : theme.text.muted
                      }
                    >
                      {statusLabel(file.status)}
                    </text>
                  </box>
                  <FilePath
                    value={file.file}
                    maxWidth={nameWidth()}
                    fg={index() === store.index ? overlay.text.action.primary.focused : theme.text.muted}
                  />
                </box>
              )}
            </For>
          </scrollbox>
        </DialogBleed>
      </box>
    </DialogLayout>
  )
}

DialogVcsFiles.show = (
  dialog: DialogContext,
  options: {
    title: string
    description?: string
    confirmLabel?: string
    files: readonly VcsFile[]
  },
) =>
  new Promise<string[] | undefined>((resolve) => {
    dialog.replace(
      () => (
        <DialogVcsFiles
          title={options.title}
          description={options.description}
          confirmLabel={options.confirmLabel}
          files={options.files}
          onConfirm={resolve}
          onCancel={() => resolve(undefined)}
        />
      ),
      () => resolve(undefined),
    )
  })
