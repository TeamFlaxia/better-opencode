import { type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { useTheme } from "../context/theme"
import { buildHunkPatch, type VcsHunkPatch } from "../util/vcs"
import {
  DIALOG_INSET,
  DialogBleed,
  DialogHeader,
  DialogLayout,
  useDialog,
  type DialogContext,
} from "../ui/dialog"
import { revealSelectionOffset } from "../ui/select-controller"
import { getScrollAcceleration } from "../util/scroll"

export function DialogVcsHunks(props: {
  title: string
  description?: string
  confirmLabel?: string
  patch: VcsHunkPatch
  onConfirm: (patch: string) => void
  onCancel: () => void
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const config = useConfig().data
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const [store, setStore] = createStore({
    index: 0,
    selected: {} as Record<number, boolean>,
  })
  const height = createMemo(() => Math.max(1, Math.min(props.patch.hunks.length, 12)))
  let scroll: ScrollBoxRenderable | undefined
  const selected = () => props.patch.hunks.filter((_hunk, index) => store.selected[index])
  const toggle = (index: number) => setStore("selected", index, !store.selected[index])
  const move = (delta: number) => {
    const index = Math.max(0, Math.min(props.patch.hunks.length - 1, store.index + delta))
    setStore("index", index)
    queueMicrotask(() => {
      if (!scroll) return
      const offset = revealSelectionOffset(scroll.scrollTop, {
        count: props.patch.hunks.length,
        limit: height(),
        selected: index,
      })
      if (offset !== scroll.scrollTop) scroll.scrollTo(offset)
    })
  }
  const confirm = () => {
    const hunks = selected()
    if (hunks.length === 0) {
      const hunk = props.patch.hunks[store.index]
      if (!hunk) return
      hunks.push(hunk)
    }
    props.onConfirm(buildHunkPatch(props.patch, hunks))
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
      toggle(store.index)
      return
    }
    if (event.name === "a") {
      event.preventDefault()
      event.stopPropagation()
      const all = props.patch.hunks.every((_hunk, index) => store.selected[index])
      setStore("selected", all ? {} : Object.fromEntries(props.patch.hunks.map((_hunk, index) => [index, true])))
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
            { title: "toggle", key: "space", onTrigger: () => toggle(store.index) },
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
          {props.description ?? "Select hunks with space, then confirm."}
        </text>
        <DialogBleed>
          <scrollbox
            ref={(value) => (scroll = value)}
            height={height()}
            backgroundColor={overlay.background.raised.high}
            scrollX={false}
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
          >
            <For each={props.patch.hunks}>
              {(hunk, index) => (
                <box
                  flexDirection="row"
                  paddingLeft={DIALOG_INSET}
                  paddingRight={DIALOG_INSET}
                  gap={1}
                  backgroundColor={index() === store.index ? overlay.background.action.primary.focused : undefined}
                  onMouseUp={() => {
                    setStore("index", index())
                    toggle(index())
                  }}
                >
                  <box width={2} flexShrink={0}>
                    <text
                      fg={
                        index() === store.index
                          ? overlay.text.action.primary.focused
                          : store.selected[index()]
                            ? theme.text.base
                            : theme.text.muted
                      }
                    >
                      {store.selected[index()] ? "x" : " "}
                    </text>
                  </box>
                  <text
                    fg={index() === store.index ? overlay.text.action.primary.focused : theme.text.muted}
                    wrapMode="none"
                    truncate
                    selectable={false}
                  >
                    {hunk.header}
                  </text>
                  <box flexGrow={1} />
                  <text
                    fg={index() === store.index ? overlay.text.action.primary.focused : overlay.diff.text.added}
                    selectable={false}
                  >
                    +{hunk.additions}
                  </text>
                  <text
                    fg={index() === store.index ? overlay.text.action.primary.focused : overlay.diff.text.removed}
                    selectable={false}
                  >
                    -{hunk.deletions}
                  </text>
                </box>
              )}
            </For>
          </scrollbox>
        </DialogBleed>
      </box>
    </DialogLayout>
  )
}

DialogVcsHunks.show = (
  dialog: DialogContext,
  options: {
    title: string
    description?: string
    confirmLabel?: string
    patch: VcsHunkPatch
  },
) =>
  new Promise<string | undefined>((resolve) => {
    dialog.replace(
      () => (
        <DialogVcsHunks
          title={options.title}
          description={options.description}
          confirmLabel={options.confirmLabel}
          patch={options.patch}
          onConfirm={resolve}
          onCancel={() => resolve(undefined)}
        />
      ),
      () => resolve(undefined),
    )
  })
