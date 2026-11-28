import { createSignal, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useI18n } from "../i18n"

export const DASHBOARD_DOCK_WIDTH = 24

type DashboardDockOrientation = "right" | "below" | "vertical"

/** Launcher for the full-pane project dashboard, kept symmetric with TASKS / VCS / FILES. */
export function DashboardDock(props: {
  orientation: DashboardDockOrientation
  width?: number
  onOpen?: () => void
}) {
  const theme = useTheme()
  const { t } = useI18n()
  const [hovered, setHovered] = createSignal(false)
  const dockWidth = () => props.width ?? DASHBOARD_DOCK_WIDTH
  const compact = () => props.orientation !== "below" && dockWidth() < 12
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
                  <b>DASHBOARD</b>
                </text>
                <box flexGrow={1} minWidth={0} />
                <text fg={theme.text.muted} flexShrink={0} selectable={false}>
                  ⟨leader+d⟩
                </text>
              </box>
              <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1}>
                <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                  {t("Project dashboard")}
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
                <b>D</b>
              </text>
            </box>
            <box height={1} flexDirection="row" justifyContent="center">
              <text fg={theme.text.action.primary.base} selectable={false}>
                ▸
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
          <b>DASHBOARD</b>
        </text>
        <box flexGrow={1} minWidth={0} />
        <text fg={theme.text.muted} wrapMode="none" selectable={false}>
          ⟨leader+d⟩
        </text>
      </box>
    </Show>
  )
}
