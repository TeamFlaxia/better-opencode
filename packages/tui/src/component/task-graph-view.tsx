/** @jsxImportSource @opentui/solid */
import { TextAttributes, type BoxRenderable, type RGBA, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { TaskLink } from "@opencode/schema/task-link"
import { useRoute } from "../context/route"
import { useTaskGraph, type TaskGraphController } from "../context/task-graph"
import { useTheme } from "../context/theme"
import { useVcs } from "../context/vcs"
import { Locale } from "../util/locale"
import {
  statusLabel,
  statusMarker,
  summarizeGraph,
  type TaskNode,
  type TaskNodeStatus,
} from "../util/task-graph"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { createPaneResize } from "../ui/pane-resize"
import { PaneResizeHandle } from "../ui/pane-resize-handle"
import { revealSelectionOffset } from "../ui/select-controller"
import { useToast } from "../ui/toast"

type TaskGraphPanel = "graph" | "execution"

export type TaskGraphVcsController = Pick<
  ReturnType<typeof useVcs>,
  | "summary"
  | "resolveLinks"
  | "newTaskChange"
  | "describeTask"
  | "bookmarkTask"
  | "editTask"
  | "squashTask"
  | "abandonTask"
  | "isAncestor"
>

export function TaskGraphView(props: {
  onClose: () => void
  onOpenVcs?: () => void
  controller?: TaskGraphController
  vcs?: TaskGraphVcsController
}) {
  const task = props.controller ?? useTaskGraph()
  const theme = useTheme()
  const vcs = props.vcs ?? useVcs()
  const clipboard = useClipboard()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const route = useRoute()
  const [focus, setFocus] = createSignal<TaskGraphPanel>("graph")
  const [selection, setSelection] = createSignal<Record<TaskGraphPanel, number>>({ graph: 0, execution: 0 })
  const [ancestry, setAncestry] = createSignal<Record<string, boolean>>({})
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
  const [bounds, setBounds] = createSignal({ x: 0, width: dimensions().width, height: dimensions().height })
  const defaultDetailsWidth = () =>
    bounds().width >= 80 ? Math.max(28, Math.min(42, Math.floor(bounds().width * 0.34))) : 0
  const [resizedDetailsWidth, setResizedDetailsWidth] = createSignal<number>()
  const detailsSize = createPaneResize({
    value: () => resizedDetailsWidth() ?? defaultDetailsWidth(),
    defaultValue: defaultDetailsWidth,
    clamp: (width) => (bounds().width < 80 ? 0 : Math.max(20, Math.min(bounds().width - 35, width))),
    fromMouse: (event) => bounds().x + bounds().width - event.x - 2,
    contains: (event, width) => {
      const boundary = bounds().x + bounds().width - width - 2
      return event.x >= boundary && event.x <= boundary + 1
    },
    onCommit: setResizedDetailsWidth,
  })
  const detailsWidth = () => detailsSize.size()
  const sidebarWidth = () => Math.max(24, bounds().width - detailsWidth() - 3)
  const listHeight = () => Math.max(5, Math.min(12, Math.floor(bounds().height * 0.3)))

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

  const vcsAvailable = () => vcs.summary()?.kind === "jj"
  const selectedTask = () => {
    const node = focused()
    return node?.kind === "task" ? node : undefined
  }
  const linkOf = (node: TaskNode) => task.links()[node.id]
  const vcsRef = (node: TaskNode) =>
    node.vcs?.change || node.vcs?.ref || linkOf(node)?.change || linkOf(node)?.bookmark
  const vcsState = (node: TaskNode) => {
    if (!node.vcs) return
    if (node.vcs.broken) return "broken" as const
    if (node.vcs.conflict) return "conflict" as const
    if (node.vcs.empty) return "empty" as const
    if (node.vcs.current) return "current" as const
    if (node.vcs.immutable) return "immutable" as const
    return "clean" as const
  }
  const vcsBadge = (node: TaskNode) => {
    const state = vcsState(node)
    if (state === "current") return "@"
    if (state === "conflict") return "!"
    if (state === "empty") return "∅"
    if (state === "broken") return "?"
    if (state === "immutable") return "◇"
    if (state === "clean") return "✓"
    return ""
  }
  const vcsColor = (node: TaskNode) => {
    const state = vcsState(node)
    if (state === "conflict" || state === "broken") return theme.text.feedback.error.base
    if (state === "empty") return theme.text.feedback.warning.base
    if (state === "current") return theme.text.feedback.info.base
    if (state === "clean") return theme.text.feedback.success.base
    return theme.text.muted
  }
  const vcsLabel = (node: TaskNode) => {
    const ref = node.vcs?.bookmarks[0] ?? node.vcs?.change ?? node.vcs?.ref
    if (!ref) return ""
    const short = ref.length > 8 ? `${ref.slice(0, 7)}…` : ref
    return `${vcsBadge(node)} ${short}`
  }
  const updateLink = (node: TaskNode, patch: Partial<TaskLink.Link>) =>
    task.setLink(node.id, { ...linkOf(node), ...patch, updatedAt: Date.now() })
  const requireJjTask = () => {
    const node = selectedTask()
    if (!node) return
    if (!vcsAvailable()) {
      toast.show({ variant: "warning", message: "VCS linking is available in a jj repository." })
      return
    }
    return node
  }
  const newChange = () => {
    const node = requireJjTask()
    if (!node) return
    const bookmark = node.vcs?.bookmarks[0] ?? `task/${node.id}`
    dialog.replace(() => (
      <DialogPrompt
        title="New jj change for task"
        value={`task(${node.id}): ${node.title}`}
        onConfirm={(value) => {
          const message = value.trim()
          if (!message) return
          dialog.clear()
          void (async () => {
            const change = await vcs.newTaskChange(message)
            if (!change) return
            await vcs.bookmarkTask(change, bookmark)
            await updateLink(node, { change, bookmark })
          })()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const describeChange = () => {
    const node = requireJjTask()
    const ref = node && vcsRef(node)
    if (!node || !ref) return
    dialog.replace(() => (
      <DialogPrompt
        title="Describe jj change"
        value={`task(${node.id}): ${node.title}`}
        onConfirm={(value) => {
          const message = value.trim()
          if (!message) return
          dialog.clear()
          void vcs.describeTask(ref, message)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const setBookmark = () => {
    const node = requireJjTask()
    const ref = node && vcsRef(node)
    if (!node || !ref) return
    dialog.replace(() => (
      <DialogPrompt
        title="Set jj bookmark"
        value={node.vcs?.bookmarks[0] ?? `task/${node.id}`}
        onConfirm={(value) => {
          const bookmark = value.trim()
          if (!bookmark) return
          dialog.clear()
          void (async () => {
            if (!(await vcs.bookmarkTask(ref, bookmark))) return
            await updateLink(node, { bookmark, change: node.vcs?.change ?? linkOf(node)?.change })
          })()
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const confirmAction = (title: string, message: string, run: () => Promise<boolean>, after?: () => Promise<void>) => {
    dialog.replace(() => (
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => {
          dialog.clear()
          void run().then((ok) => (ok && after ? after() : undefined))
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const editChange = () => {
    const node = requireJjTask()
    const ref = node && vcsRef(node)
    if (!node || !ref) return
    confirmAction("Edit jj change", `Switch the working copy to ${ref}?`, () => vcs.editTask(ref))
  }
  const squashChange = () => {
    const node = requireJjTask()
    const ref = node && vcsRef(node)
    if (!node || !ref) return
    confirmAction("Squash jj change", `Squash ${ref} into its parent? The change may disappear.`, () => vcs.squashTask(ref), () =>
      updateLink(node, { change: undefined }),
    )
  }
  const abandonChange = () => {
    const node = requireJjTask()
    const ref = node && vcsRef(node)
    if (!node || !ref) return
    confirmAction("Abandon jj change", `Abandon ${ref}? This removes the change and its content.`, () => vcs.abandonTask(ref), () =>
      task.removeLink(node.id),
    )
  }
  const validateDependencies = () => {
    const node = requireJjTask()
    const target = node?.vcs?.change
    if (!node || !target) {
      if (node) toast.show({ variant: "warning", message: "Link a jj change to this task first." })
      return
    }
    const dependencies = node.dependsOn.flatMap((id) => {
      const dependency = model().tasks.find((item) => item.id === id)
      return dependency?.vcs?.change ? [{ id, change: dependency.vcs.change }] : []
    })
    if (dependencies.length === 0) {
      toast.show({ variant: "info", message: "No linked dependency changes to validate." })
      return
    }
    void (async () => {
      const result: Record<string, boolean> = {}
      for (const dependency of dependencies) result[dependency.id] = await vcs.isAncestor(dependency.change, target)
      setAncestry(result)
      const missing = Object.entries(result).filter(([, ok]) => !ok).map(([id]) => id)
      toast.show({
        variant: missing.length > 0 ? "warning" : "success",
        message: missing.length > 0 ? `Not an ancestor: ${missing.join(", ")}` : "Dependency changes are ancestors.",
      })
    })()
  }
  const copyRef = () => {
    const node = selectedTask()
    const value = node?.vcs?.bookmarks[0] ?? node?.vcs?.change ?? (node ? vcsRef(node) : undefined)
    if (!value) return
    void clipboard
      .write(value)
      .then(() => toast.show({ variant: "info", message: `Copied ${value}` }))
      .catch(toast.error)
  }
  const taskActions = () => {
    const node = requireJjTask()
    if (!node) return
    const ref = vcsRef(node)
    const actions = [
      { title: "New change", value: "new" as const, description: "Create a change and bookmark for this task" },
      ...(ref
        ? [
            { title: "Describe change", value: "describe" as const, description: ref },
            { title: "Set bookmark", value: "bookmark" as const, description: node.vcs?.bookmarks[0] ?? `task/${node.id}` },
            { title: "Edit change", value: "edit" as const, description: `Switch the working copy to ${ref}` },
            { title: "Squash into parent", value: "squash" as const, description: `Squash ${ref}` },
            { title: "Abandon change", value: "abandon" as const, description: `Abandon ${ref}` },
            { title: "Validate dependencies", value: "validate" as const, description: "Check jj ancestry" },
          ]
        : []),
      { title: "Copy change or bookmark", value: "copy" as const, description: ref },
      { title: "Open version control", value: "vcs" as const, description: "Open the VCS view" },
    ]
    const run = (value: (typeof actions)[number]["value"]) => {
      if (value === "new") return newChange()
      if (value === "describe") return describeChange()
      if (value === "bookmark") return setBookmark()
      if (value === "edit") return editChange()
      if (value === "squash") return squashChange()
      if (value === "abandon") return abandonChange()
      if (value === "validate") return validateDependencies()
      if (value === "copy") return copyRef()
      if (value === "vcs") return props.onOpenVcs?.()
    }
    dialog.replace(() => (
      <DialogSelect
        title="Task actions"
        options={actions}
        onSelect={(option) => {
          dialog.clear()
          run(option.value)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
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
    if (key === "space") {
      handled()
      taskActions()
      return
    }
    if (key === "n") {
      handled()
      newChange()
      return
    }
    if (key === "d") {
      handled()
      describeChange()
      return
    }
    if (key === "b") {
      handled()
      setBookmark()
      return
    }
    if (key === "e") {
      handled()
      editChange()
      return
    }
    if (key === "s") {
      handled()
      squashChange()
      return
    }
    if (key === "a") {
      handled()
      abandonChange()
      return
    }
    if (key === "v") {
      handled()
      validateDependencies()
      return
    }
    if (key === "y") {
      handled()
      copyRef()
      return
    }
    if (key === "o") {
      handled()
      props.onOpenVcs?.()
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
  const vcsWidth = (panel: TaskGraphPanel, node: TaskNode) =>
    panel === "graph" && node.kind === "task" && node.vcs && sidebarWidth() >= 54 ? 12 : 0
  const rowWidths = (panel: TaskGraphPanel, node: TaskNode) => {
    const available = Math.max(12, sidebarWidth() - rowIndent(panel, node))
    const detail = Math.min(panel === "graph" ? 28 : 36, Math.floor(available * 0.4))
    const vcs = vcsWidth(panel, node)
    return { title: Math.max(6, available - 4 - 1 - 9 - detail - vcs), detail, vcs }
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
        <Show when={widths().vcs > 0}>
          <text
            width={widths().vcs}
            fg={textColor(panel, index, current().status, vcsColor(current()))}
            wrapMode="none"
            selectable={false}
          >
            {Locale.truncateWidth(vcsLabel(current()), widths().vcs)}
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
      <box flexDirection="column" width="100%">
        <text width="100%" fg={theme.text.muted} selectable={false}>
          {label}
        </text>
        <text width="100%" fg={valueColor ?? theme.text.base} wrapMode="char" selectable={false}>
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
      onMouseDrag={detailsSize.onMouseDrag}
      onMouseDragEnd={detailsSize.onMouseUp}
      onMouseUp={detailsSize.onMouseUp}
      onSizeChange={function () {
        setBounds({ x: this.x, width: this.width, height: this.height })
      }}
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
        <box
          flexGrow={1}
          minHeight={0}
          flexDirection="row"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          position="relative"
        >
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
            id="task-graph-details"
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
                <scrollbox flexGrow={1} minHeight={0} scrollX={false} verticalScrollbarOptions={{ visible: true }}>
                  <box width="100%" flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
                    <text width="100%" fg={theme.text.base} wrapMode="char" selectable={false}>
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
                    {current().node.vcs && (
                      <box flexDirection="column" gap={1}>
                        <text fg={theme.text.muted} selectable={false}>
                          VCS
                        </text>
                        <text fg={vcsColor(current().node)} selectable={false}>
                          {vcsState(current().node) ?? "linked"}
                          {current().node.vcs!.broken ? " · link not found" : ""}
                        </text>
                        {detailRow("Change", current().node.vcs!.change || current().node.vcs!.ref)}
                        {detailRow("Commit", current().node.vcs!.commit || undefined)}
                        {detailRow("Bookmarks", current().node.vcs!.bookmarks.join(", ") || undefined)}
                        {detailRow("Parent", current().node.vcs!.parents.join(", ") || undefined)}
                      </box>
                    )}
                    {detailRow("Depends on", current().node.dependsOn.join(", ") || undefined)}
                    {detailRow(
                      "Ancestry",
                      current()
                        .node.dependsOn.flatMap((id) =>
                          ancestry()[id] === undefined ? [] : [`${id}: ${ancestry()[id] ? "ancestor" : "not ancestor"}`],
                        )
                        .join(" · ") || undefined,
                    )}
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
          <Show when={detailsWidth() > 0}>
            <PaneResizeHandle resize={detailsSize} left={1 + sidebarWidth()} />
          </Show>
        </box>
      </Show>

      <box height={1} flexShrink={0} flexDirection="row" gap={2} paddingLeft={1} paddingRight={1}>
        <For
          each={[
            { key: "↑/↓", label: "select" },
            { key: "tab", label: "pane" },
            { key: "space", label: "actions" },
            { key: "o", label: "vcs" },
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
