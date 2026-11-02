import { createMemo, createSignal, Show } from "solid-js"
import { useVcs } from "../context/vcs"
import { useTheme } from "../context/theme"
import { useClipboard } from "../context/clipboard"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { Keymap } from "../context/keymap"
import { Locale } from "../util/locale"

export const VCS_DOCK_WIDTH = 24
export const VCS_DOCK_MIN_TERMINAL_WIDTH = 96

type VcsDockOrientation = "right" | "below" | "vertical"
type VcsAction = "actions" | "open" | "diff" | "copy" | "refresh"
export type VcsDockController = Pick<
  ReturnType<typeof useVcs>,
  "visible" | "summary" | "refreshing" | "tool" | "openTool" | "refresh"
>

export function VcsDock(props: {
  orientation: VcsDockOrientation
  width?: number
  controller?: VcsDockController
  onOpen?: () => void
}) {
  const vcs = props.controller ?? useVcs()
  const theme = useTheme()
  const clipboard = useClipboard()
  const dialog = useDialog()
  const toast = useToast()
  const keymap = Keymap.use()
  const [hovered, setHovered] = createSignal(false)
  const summary = () => vcs.summary()
  const tool = () => vcs.tool()
  const dockWidth = () => props.width ?? VCS_DOCK_WIDTH
  const compact = () => props.orientation !== "below" && dockWidth() < 12
  const kind = () => {
    const value = summary()?.kind
    return value === "jj" ? "jj" : value === "hg" ? "hg" : "git"
  }
  const label = () => summary()?.label || "detached"
  const detail = () => (summary()?.conflict ? "conflict" : summary()?.detail || "clean")
  const status = () => {
    const current = summary()
    if (!current) return ""
    if (vcs.refreshing()) return "…"
    if (current.conflict) return "!"
    return current.dirty === 0 ? "✓" : String(current.dirty)
  }
  const path = () =>
    props.orientation === "vertical" || props.orientation === "right"
      ? theme.background.raised.base
      : theme.background.base
  const background = () => (hovered() ? theme.background.raised.high : path())
  const detailColor = () => (summary()?.conflict ? theme.text.feedback.error.base : theme.text.muted)
  const statusColor = () => {
    const current = summary()
    if (!current) return theme.text.muted
    if (current.conflict) return theme.text.feedback.error.base
    return current.dirty === 0 ? theme.text.muted : theme.text.base
  }
  const actions = createMemo(() => {
    const current = summary()
    const selected = tool()
    return [
      { title: "Version control actions", value: "actions" as const, description: "Manage the repository" },
      ...(selected
        ? [{ title: `Open ${selected.label}`, value: "open" as const, description: "Launch the external TUI" }]
        : []),
      { title: "Open diff viewer", value: "diff" as const, description: "Review changes inside OpenCode" },
      ...(current?.change
        ? [{ title: "Copy change ID", value: "copy" as const, description: current.change }]
        : current
          ? [{ title: "Copy branch", value: "copy" as const, description: current.label }]
          : []),
      { title: "Refresh status", value: "refresh" as const, description: "Reload version control state" },
    ]
  })
  const run = (action: VcsAction) => {
    dialog.clear()
    if (action === "actions") return props.onOpen?.()
    if (action === "open") return void vcs.openTool()
    if (action === "diff") return keymap.dispatch("diff.open")
    if (action === "refresh") return void vcs.refresh()
    const current = summary()
    if (!current) return
    const value = current.change ?? current.label
    void clipboard
      .write(value)
      .then(() => toast.show({ message: "Version control identifier copied", variant: "info" }))
      .catch(toast.error)
  }
  const menu = () => {
    dialog.replace(() => (
      <DialogSelect
        title="Version control"
        options={actions()}
        onSelect={(option) => run(option.value)}
      />
    ))
  }
  let menuPressed = false
  const pointer = {
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseDown: (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
      menuPressed = event.button === 2
      if (menuPressed) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onMouseUp: (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.button === 2) {
        // Open on release: the dialog backdrop would close a menu opened on press.
        if (menuPressed) menu()
        menuPressed = false
        return
      }
      menuPressed = false
      props.onOpen?.()
    },
  }

  return (
    <Show when={vcs.visible() && summary()}>
      <Show
        when={props.orientation === "below"}
        fallback={
          <Show
            when={compact()}
            fallback={
              <box
                width={dockWidth()}
                height={2}
                flexShrink={0}
                flexDirection="column"
                backgroundColor={background()}
                {...pointer}
              >
                <box height={1} flexDirection="row" paddingLeft={1} gap={1}>
                  <text fg={theme.text.base} selectable={false}>
                    <b>{kind()}</b>
                  </text>
                  <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                    {Locale.truncateWidth(label(), Math.max(1, dockWidth() - 10))}
                  </text>
                  <box flexGrow={1} />
                  <text fg={statusColor()} selectable={false}>
                    {status()}
                  </text>
                  <box width={1} />
                </box>
                <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
                  <text fg={detailColor()} wrapMode="none" truncate selectable={false}>
                    {detail()}
                  </text>
                </box>
              </box>
            }
          >
            <box
              width={dockWidth()}
              height={2}
              flexShrink={0}
              flexDirection="column"
              backgroundColor={background()}
              {...pointer}
            >
              <box height={1} flexDirection="row" justifyContent="center">
                <text fg={theme.text.base} selectable={false}>
                  <b>{kind()}</b>
                </text>
              </box>
              <box height={1} flexDirection="row" justifyContent="center">
                <text fg={statusColor()} selectable={false}>
                  {status()}
                </text>
              </box>
            </box>
          </Show>
        }
      >
        <box
          height={1}
          flexShrink={0}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          gap={1}
          backgroundColor={background()}
          {...pointer}
        >
          <text fg={theme.text.base} selectable={false}>
            <b>{kind()}</b>
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
            {label()}
          </text>
          <text fg={statusColor()} selectable={false}>
            {status()}
          </text>
          <text fg={detailColor()} wrapMode="none" truncate selectable={false}>
            {detail()}
          </text>
          <box flexGrow={1} />
          <text fg={theme.text.muted} wrapMode="none" selectable={false}>
            vcs ⟨leader+v⟩
          </text>
        </box>
      </Show>
    </Show>
  )
}
