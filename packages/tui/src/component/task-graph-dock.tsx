import { createSignal, Show } from "solid-js"
import { useTaskGraph, type TaskGraphController } from "../context/task-graph"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { graphColor, statusLabel, statusMarker, summarizeGraph, type TaskNodeStatus } from "../util/task-graph"

export const TASK_GRAPH_DOCK_WIDTH = 24

type TaskGraphDockOrientation = "right" | "below" | "vertical"

export function TaskGraphDock(props: {
  orientation: TaskGraphDockOrientation
  width?: number
  onOpen?: () => void
  controller?: TaskGraphController
}) {
  const graph = props.controller ?? useTaskGraph()
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const dockWidth = () => props.width ?? TASK_GRAPH_DOCK_WIDTH
  const compact = () => props.orientation !== "below" && dockWidth() < 12
  const model = () => graph.graph()
  const status = () => graphColor(model())
  const color = (value: TaskNodeStatus | undefined) => {
    if (value === "done") return theme.text.feedback.success.base
    if (value === "running") return theme.text.feedback.info.base
    if (value === "waiting" || value === "stalled") return theme.text.feedback.warning.base
    if (value === "blocked" || value === "failed") return theme.text.feedback.error.base
    return theme.text.muted
  }
  const background = () =>
    hovered()
      ? theme.background.raised.high
      : props.orientation === "below"
        ? theme.background.base
        : theme.background.raised.base
  const current = () => model().current
  const title = () => {
    if (current()) return current()!.title
    if (model().goal) return model().goal!.objective
    return "No tasks yet"
  }
  const detail = () => {
    if (current()) return statusLabel(current()!.status)
    if (model().goal?.status === "paused") return "paused"
    if (model().goal?.status === "complete") return "complete"
    return summarizeGraph(model())
  }
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
    <Show when={graph.visible()}>
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
                    <b>TASKS</b>
                  </text>
                  <box flexGrow={1} minWidth={0} />
                  <text fg={color(status())} flexShrink={0} selectable={false}>
                    {current() ? statusMarker(current()!.status) : summarizeGraph(model())}
                  </text>
                </box>
                <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
                  <text width={Math.max(1, dockWidth() - 10)} fg={theme.text.base} wrapMode="none" truncate selectable={false}>
                    {Locale.truncateWidth(title(), Math.max(1, dockWidth() - 10))}
                  </text>
                  <box flexGrow={1} minWidth={0} />
                  <text fg={color(status())} wrapMode="none" truncate selectable={false}>
                    {Locale.truncateWidth(detail(), 9)}
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
                  <b>T</b>
                </text>
              </box>
              <box height={1} flexDirection="row" justifyContent="center">
                <text fg={color(status())} selectable={false}>
                  {model().counts.total > 0
                    ? `${model().counts.done}/${model().counts.total}`
                    : current()
                      ? statusMarker(current()!.status)
                      : "—"}
                </text>
              </box>
            </box>
          </Show>
        }
      >
        <box
          height={2}
          flexShrink={0}
          flexDirection="column"
          backgroundColor={background()}
          {...pointer}
        >
          <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
            <text fg={theme.text.base} selectable={false}>
              <b>TASKS</b>
            </text>
            <text fg={color(status())} selectable={false}>
              {summarizeGraph(model())}
            </text>
            <box flexGrow={1} minWidth={0} />
            <Show when={model().goal}>
              <text fg={theme.text.muted} selectable={false}>
                {model().goal!.status === "active" ? "◎ goal" : `◎ ${model().goal!.status}`}
              </text>
            </Show>
          </box>
          <box height={1} flexDirection="row" paddingLeft={1} paddingRight={1} gap={1}>
            <text fg={current() ? theme.text.base : theme.text.muted} wrapMode="none" truncate selectable={false}>
              {title()}
            </text>
            <box flexGrow={1} minWidth={0} />
            <text fg={color(status())} wrapMode="none" truncate selectable={false}>
              {detail()}
            </text>
          </box>
        </box>
      </Show>
    </Show>
  )
}
