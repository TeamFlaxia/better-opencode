import { createSignal, Show } from "solid-js"
import { useFileManager } from "../context/file-manager"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"

export const FILE_MANAGER_DOCK_WIDTH = 24

type FileManagerDockOrientation = "right" | "below" | "vertical"

export type FileManagerDockController = Pick<
  ReturnType<typeof useFileManager>,
  "visible" | "root" | "path" | "entries" | "loading"
>

export function FileManagerDock(props: {
  orientation: FileManagerDockOrientation
  width?: number
  controller?: FileManagerDockController
  onOpen?: () => void
}) {
  const fileManager = props.controller ?? useFileManager()
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const dockWidth = () => props.width ?? FILE_MANAGER_DOCK_WIDTH
  const compact = () => props.orientation !== "below" && dockWidth() < 12
  const rootName = () => {
    const value = fileManager.root()
    if (!value) return ""
    const trimmed = value.replace(/[\\/]+$/, "")
    const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
    return trimmed.slice(index + 1) || value
  }
  const label = () => rootName() || "root"
  const detail = () => fileManager.path() || "root"
  const count = () => (fileManager.loading() ? "…" : String(fileManager.entries().length))
  const labelWidth = () => Math.max(1, dockWidth() - 10)
  const background = () =>
    hovered()
      ? theme.background.raised.high
      : props.orientation === "below"
        ? theme.background.base
        : theme.background.raised.base
  const pointer = {
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseUp: (event: { button: number; preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault()
      event.stopPropagation()
      props.onOpen?.()
    },
  }

  return (
    <Show when={fileManager.visible()}>
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
                <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
                  <text fg={theme.text.base} flexShrink={0} selectable={false}>
                    <b>FILES</b>
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                      {Locale.truncateWidth(label(), labelWidth())}
                    </text>
                  </box>
                  <text fg={theme.text.muted} flexShrink={0} selectable={false}>
                    {count()}
                  </text>
                </box>
                <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                      {Locale.truncateWidth(detail(), labelWidth())}
                    </text>
                  </box>
                  <Show when={props.orientation === "right"}>
                    <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
                      ⟨leader+f⟩
                    </text>
                  </Show>
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
                  <b>F</b>
                </text>
              </box>
              <box height={1} flexDirection="row" justifyContent="center">
                <text fg={theme.text.muted} selectable={false}>
                  {count()}
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
            <b>FILES</b>
          </text>
          <text fg={theme.text.base} wrapMode="none" truncate selectable={false}>
            {label()}
          </text>
          <text fg={theme.text.muted} selectable={false}>
            ·
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
            {detail()}
          </text>
          <text fg={theme.text.muted} selectable={false}>
            {count()}
          </text>
          <box flexGrow={1} />
          <text fg={theme.text.muted} wrapMode="none" selectable={false}>
            ⟨leader+f⟩
          </text>
        </box>
      </Show>
    </Show>
  )
}
