/** @jsxImportSource @opentui/solid */
import { TextAttributes, type BoxRenderable, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useRoute } from "../context/route"
import { useTaskGraph, type TaskGraphController } from "../context/task-graph"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import {
  statusLabel,
  statusMarker,
  summarizeGraph,
  type TaskNode,
  type TaskNodeStatus,
} from "../util/task-graph"
import { revealSelectionOffset } from "../ui/select-controller"

type TaskGraphPanel = "graph" | "execution"

export function TaskGraphView(props: { onClose: () => void; controller?: TaskGraphController }) {
  const task = props.controller ?? useTaskGraph()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const route = useRoute()
  const [focus, setFocus] = createSignal<TaskGraphPanel>("graph")
  const [selection, setSelection] = createSignal<Record<TaskGraphPanel, number>>({ graph: 0, execution: 0 })
  const scrolls: Partial<Record<TaskGraphPanel, ScrollBoxRenderable>> = {}
  let root: BoxRenderable | undefined
  onMount(() => {
    const timer = setTimeout(() => {
      if (root && !root.isDestroyed) root.focus()
    }, 1)
    onCleanup(() => clearTimeout(timer))
  })

  const model = () => task.graph()
  const nodesFor = (panel: TaskGraphPanel) => (panel === "graph" ? model().tasks : model().execution)
  const selectedFor = (panel: TaskGraphPanel) => selection()[panel]
  const selected = () => nodesFor(focus()).at(selectedFor(focus()))
  const focused = (): TaskNode | undefined => selected()
  const countFor = (panel: TaskGraphPanel) => nodesFor(panel).length
  const graphRows = createMemo(() => {
    const tasks = model().tasks
    const rows: { layer: number; node: TaskNode; index: number }[] = []
    tasks.forEach((node, index) => rows.push({ layer: node.layer, node, index }))
    return rows
  })
  const executionRows = createMemo(() => model().execution.map((node, index) => ({ node, index })))

  const visualRow = (panel: TaskGraphPanel, index: number) => {
    if (panel !== "graph") return index
    const rows = graphRows()
    let row = index
    for (let position = 1; position <= index; position++) {
      if (rows[position] && rows[position - 1] && rows[position]!.layer !== rows[position - 1]!.layer) row++
    }
    return row
  }
  const visualCount = (panel: TaskGraphPanel) =>
    panel === "graph" ? graphRows().length + new Set(graphRows().map((row) => row.layer)).size : executionRows().length
  const detailsWidth = () =>
    dimensions().width >= 80 ? Math.max(28, Math.min(42, Math.floor(dimensions().width * 0.34))) : 0
  const sidebarWidth = () => Math.max(24, dimensions().width - detailsWidth() - 3)
  const listHeight = () => Math.max(5, Math.min(12, Math.floor(dimensions().height * 0.3)))

  const color = (status: TaskNodeStatus | undefined, selected: boolean) => {
    if (selected) return theme.text.action.primary.focused
    if (status === "done") return theme.text.feedback.success.base
    if (status === "running") return theme.text.feedback.info.base
    if (status === "waiting" || status === "stalled") return theme.text.feedback.warning.base
    if (status === "blocked" || status === "failed") return theme.text.feedback.error.base
    if (status === "ready") return theme.text.base
    return theme.text.muted
  }
  const background = (panel: TaskGraphPanel, index: number) => {
    if (focus() !== panel || selectedFor(panel) !== index) return undefined
    return theme.background.action.primary.focused
  }
  const textColor = (panel: TaskGraphPanel, index: number, status: TaskNodeStatus, base: RGBA) => {
    if (focus() === panel && selectedFor(panel) === index) return theme.text.action.primary.focused
    return base
  }

  createEffect(() => {
    const panel = focus()
    const index = selectedFor(panel)
    queueMicrotask(() => {
      const scroll = scrolls[panel]
      if (!scroll) return
      const limit = scroll.viewport.height
      if (limit <= 0) return
      const offset = revealSelectionOffset(scroll.scrollTop, {
        count: visualCount(panel),
        limit,
        selected: visualRow(panel, index),
      })
      if (offset !== scroll.scrollTop) scroll.scrollTo(offset)
    })
  })

  const move = (delta: number) => {
    const panel = focus()
    const total = countFor(panel)
    if (total === 0) return
    setSelection((value) => ({
      ...value,
      [panel]: Math.max(0, Math.min(total - 1, value[panel] + delta)),
    }))
  }
  const switchPanel = () => setFocus((value) => (value === "graph" ? "execution" : "graph"))
  const open = () => {
    const node = focused()
    if (!node?.sessionID) return
    props.onClose()
    route.navigate({ type: "session", sessionID: node.sessionID })
  }

  useKeyboard((event) => {
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
    if (key === "tab" || key === "left" || key === "right") {
      handled()
      switchPanel()
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
      setSelection((value) => ({ ...value, [focus()]: 0 }))
      return
    }
    if (key === "end") {
      handled()
      setSelection((value) => ({ ...value, [focus()]: Math.max(0, countFor(focus()) - 1) }))
      return
    }
    if (key === "pageup" || key === "pagedown") {
      handled()
      const page = Math.max(1, (scrolls[focus()]?.viewport.height ?? 1) - 1)
      move(key === "pagedown" ? page : -page)
      return
    }
    if (key === "enter" || key === "return") {
      handled()
      open()
      return
    }
    if (key === "r") {
      handled()
      void task.refresh()
    }
  })

  const layerLabel = (index: number) => (index === 0 ? "Ready to start" : `Depends on layer ${index}`)

  const rowIndent = (panel: TaskGraphPanel, node: TaskNode) =>
    panel === "graph" ? 1 + Math.min(6, node.layer) * 2 : 1
  const rowWidths = (panel: TaskGraphPanel, node: TaskNode) => {
    const available = Math.max(12, sidebarWidth() - rowIndent(panel, node))
    const detail = Math.min(panel === "graph" ? 28 : 36, Math.floor(available * 0.4))
    return { title: Math.max(6, available - 4 - 1 - 9 - detail), detail }
  }
  const nodeRow = (panel: TaskGraphPanel, node: () => TaskNode, index: number) => {
    const current = () => node()
    const widths = () => rowWidths(panel, current())
    const dependencies = () => {
      if (current().kind !== "task") return current().detail
      return [
        current().dependsOn.length ? `← ${current().dependsOn.join(", ")}` : undefined,
        model().dependents[current().id]?.length ? `→ ${model().dependents[current().id]!.join(", ")}` : undefined,
        current().reason,
      ]
        .filter(Boolean)
        .join(" · ")
    }
    return (
      <box
        height={1}
        flexDirection="row"
        paddingLeft={rowIndent(panel, current())}
        paddingRight={1}
        backgroundColor={background(panel, index)}
        onMouseUp={() => {
          setFocus(panel)
          setSelection((value) => ({ ...value, [panel]: index }))
        }}
      >
        <text
          width={4}
          fg={textColor(panel, index, current().status, color(current().status, false))}
          attributes={TextAttributes.BOLD}
          selectable={false}
        >
          {`${statusMarker(current().status)} `}
        </text>
        <text
          fg={textColor(panel, index, current().status, theme.text.base)}
          attributes={current().kind === "step" ? TextAttributes.BOLD : undefined}
          wrapMode="none"
          selectable={false}
        >
          {Locale.truncateWidth(current().title, widths().title)}
        </text>
        <box flexGrow={1} minWidth={0} />
        <Show when={dependencies() && widths().detail > 0}>
          <text
            width={widths().detail}
            fg={textColor(panel, index, current().status, theme.text.muted)}
            wrapMode="none"
            truncate
            selectable={false}
          >
            {Locale.truncateWidth(dependencies()!, widths().detail)}
          </text>
        </Show>
        <box width={1} />
        <text
          width={9}
          fg={textColor(panel, index, current().status, color(current().status, false))}
          wrapMode="none"
          selectable={false}
        >
          {statusLabel(current().status)}
        </text>
      </box>
    )
  }


  const detailRow = (label: string, value: string | undefined, valueColor?: RGBA) => (
    <Show when={value}>
      <box flexDirection="column">
        <text fg={theme.text.muted} selectable={false}>
          {label}
        </text>
        <text fg={valueColor ?? theme.text.base} wrapMode="word" selectable={false}>
          {value}
        </text>
      </box>
    </Show>
  )

  const details = () => {
    const node = focused()
    if (!node) return undefined
    const dependents = model().dependents[node.id] ?? []
    const started = node.started ? new Date(node.started).toISOString().slice(11, 19) : undefined
    const completed = node.completed ? new Date(node.completed).toISOString().slice(11, 19) : undefined
    return { node, dependents, started, completed }
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
      <box height={3} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1}>
        <box height={1} flexDirection="row" gap={1}>
          <text fg={theme.text.base} selectable={false}>
            <b>Task graph</b>
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
            {model().goal ? `◎ ${model().goal!.objective}` : "no goal"}
          </text>
          <box flexGrow={1} minWidth={0} />
          <text fg={theme.text.muted} selectable={false}>
            {summarizeGraph(model())}
          </text>
        </box>
        <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
          {model().goal
            ? `goal ${model().goal!.status}${model().goal!.reason ? ` · ${model().goal!.reason}` : ""} · round ${model().goal!.rounds}/${model().goal!.maxRounds}`
            : "Ask the agent to split work, or start a goal with /goal <objective>."}
        </text>
      </box>

      <Show
        when={model().tasks.length > 0 || model().execution.length > 0}
        fallback={
          <box flexGrow={1} paddingLeft={1} paddingTop={1}>
            <text fg={theme.text.muted} selectable={false}>
              No tasks yet. Start a goal with /goal &lt;objective&gt; or ask the agent to split the work.
            </text>
          </box>
        }
      >
        <box flexGrow={1} minHeight={0} flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
          <box width={sidebarWidth()} flexShrink={0} flexDirection="column">
            <box
              flexGrow={1}
              minHeight={0}
              flexDirection="column"
              border
              borderColor={focus() === "graph" ? theme.background.action.primary.focused : theme.border.base}
              title="Tasks"
              titleColor={focus() === "graph" ? theme.text.base : theme.text.muted}
              backgroundColor={theme.background.raised.base}
              onMouseDown={() => setFocus("graph")}
            >
              <Show
                when={graphRows().length > 0}
                fallback={
                  <box height={1} paddingLeft={1}>
                    <text fg={theme.text.muted} selectable={false}>
                      No declared tasks; execution is shown below.
                    </text>
                  </box>
                }
              >
                <scrollbox
                  ref={(node) => (scrolls.graph = node)}
                  flexGrow={1}
                  scrollX={false}
                  verticalScrollbarOptions={{ visible: true }}
                >
                  <For each={graphRows()}>
                    {(row, index) => (
                      <box flexDirection="column">
                        <Show when={index() === 0 || graphRows()[index() - 1]!.layer !== row.layer}>
                          <box height={1} paddingLeft={1}>
                            <text fg={theme.text.muted} selectable={false}>
                              <b>{layerLabel(row.layer)}</b>
                            </text>
                          </box>
                        </Show>
                        {nodeRow("graph", () => row.node, row.index)}
                      </box>
                    )}
                  </For>
                </scrollbox>
              </Show>
            </box>

            <box
              height={listHeight()}
              flexShrink={0}
              flexDirection="column"
              border
              borderColor={focus() === "execution" ? theme.background.action.primary.focused : theme.border.base}
              title="Execution"
              titleColor={focus() === "execution" ? theme.text.base : theme.text.muted}
              backgroundColor={theme.background.raised.base}
              onMouseDown={() => setFocus("execution")}
            >
              <Show
                when={executionRows().length > 0}
                fallback={
                  <box height={1} paddingLeft={1}>
                    <text fg={theme.text.muted} selectable={false}>
                      No execution yet.
                    </text>
                  </box>
                }
              >
                <scrollbox
                  ref={(node) => (scrolls.execution = node)}
                  flexGrow={1}
                  scrollX={false}
                  verticalScrollbarOptions={{ visible: true }}
                >
                  <For each={executionRows()}>
                    {(row) => nodeRow("execution", () => row.node, row.index)}
                  </For>
                </scrollbox>
              </Show>
            </box>
          </box>

          <Show when={detailsWidth() > 0}>
          <box
            width={detailsWidth()}
            flexShrink={0}
            flexDirection="column"
            border
            borderColor={theme.border.base}
            title="Details"
            titleColor={theme.text.muted}
            backgroundColor={theme.background.raised.base}
          >
            <Show
              when={details()}
              fallback={
                <box paddingLeft={1} paddingTop={1}>
                  <text fg={theme.text.muted} selectable={false}>
                    Select a task or execution node.
                  </text>
                </box>
              }
            >
              {(current) => (
                <scrollbox flexGrow={1} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                  <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
                    <text fg={theme.text.base} wrapMode="word" selectable={false}>
                      {current().node.title}
                    </text>
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.text.muted} selectable={false}>
                        {current().node.kind}
                      </text>
                      <text fg={color(current().node.status, false)} selectable={false}>
                        {statusLabel(current().node.status)}
                      </text>
                    </box>
                    {detailRow("Reason", current().node.reason, theme.text.feedback.warning.base)}
                    {detailRow("Detail", current().node.detail)}
                    {detailRow("Depends on", current().node.dependsOn.join(", ") || undefined)}
                    {detailRow("Dependents", current().dependents.join(", ") || undefined)}
                    {detailRow("Tokens", current().node.tokens?.toLocaleString())}
                    {detailRow("Cost", current().node.cost?.toFixed(4))}
                    {detailRow("Started", current().started)}
                    {detailRow("Completed", current().completed)}
                    {detailRow("Session", current().node.sessionID)}
                    <Show when={current().node.sessionID}>
                      <text fg={theme.text.muted} selectable={false}>
                        enter opens the session
                      </text>
                    </Show>
                  </box>
                </scrollbox>
              )}
            </Show>
          </box>
          </Show>
        </box>
      </Show>

      <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
        <For
          each={[
            { key: "↑/↓", label: "select" },
            { key: "tab", label: "pane" },
            { key: "enter", label: "open" },
            { key: "r", label: "refresh" },
            { key: "q", label: "close" },
          ]}
        >
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
    </box>
  )
}
