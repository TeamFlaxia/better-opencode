import { graphemes, truncateWidth } from "./locale"
import { stringWidth } from "./string-width"
import { statusLabel, statusMarker, type TaskNode, type TaskNodeStatus } from "./task-graph"

export type TaskChartPart = "header" | "edge" | "border" | "title" | "marker" | "status" | "vcs" | "muted"

export type TaskChartCell = {
  readonly text: string
  readonly part: TaskChartPart
  readonly status?: TaskNodeStatus
  readonly nodeID?: string
}

export type TaskChartNodeRange = {
  readonly id: string
  readonly start: number
  readonly end: number
}

export type TaskChartRow = {
  readonly cells: readonly TaskChartCell[]
  readonly nodes: readonly TaskChartNodeRange[]
}

export type TaskChart = {
  readonly width: number
  readonly rows: readonly TaskChartRow[]
  /** The chart row of each node's top border, used to reveal the selected node. */
  readonly top: Readonly<Record<string, number>>
}

type DraftCell = TaskChartCell & { readonly mask?: number }

const UP = 1
const DOWN = 2
const LEFT = 4
const RIGHT = 8

const LINES: Record<number, string> = {
  [UP]: "│",
  [DOWN]: "│",
  [LEFT]: "─",
  [RIGHT]: "─",
  [UP | DOWN]: "│",
  [LEFT | RIGHT]: "─",
  [DOWN | RIGHT]: "┌",
  [DOWN | LEFT]: "┐",
  [UP | RIGHT]: "└",
  [UP | LEFT]: "┘",
  [UP | DOWN | RIGHT]: "├",
  [UP | DOWN | LEFT]: "┤",
  [DOWN | LEFT | RIGHT]: "┬",
  [UP | LEFT | RIGHT]: "┴",
  [UP | DOWN | LEFT | RIGHT]: "┼",
}

/**
 * Lays out declared tasks as a layered node chart: one row of boxes per dependency layer, joined by orthogonal
 * edges. Layers wider than the pane wrap into continuation bands so the chart keeps fitting without horizontal scroll.
 */
export function layoutTaskChart(input: {
  readonly tasks: ReadonlyArray<TaskNode>
  readonly width: number
  readonly layerLabel: (layer: number) => string
  readonly vcsLabel?: (node: TaskNode) => string
}): TaskChart {
  const width = Math.max(10, Math.floor(input.width))
  const tasks = input.tasks
  if (tasks.length === 0) return { width, rows: [], top: {} }

  const maxLayer = Math.max(...tasks.map((task) => task.layer))
  const layers: TaskNode[][] = []
  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodes = tasks.filter((task) => task.layer === layer)
    if (nodes.length > 0) layers.push(nodes)
  }

  const widest = Math.max(...layers.map((layer) => layer.length))
  const preferred = Math.min(26, Math.max(14, Math.max(...tasks.map((task) => stringWidth(task.title))) + 4))
  let gap = 3
  let nodeWidth = Math.min(preferred, Math.floor((width - (widest - 1) * gap) / widest))
  if (nodeWidth < 12) {
    gap = 1
    nodeWidth = Math.min(preferred, Math.floor((width - (widest - 1)) / widest))
  }
  nodeWidth = Math.min(width, Math.max(10, nodeWidth))
  const perBand = Math.max(1, Math.floor((width + gap) / (nodeWidth + gap)))

  const canvas = new Canvas(width)
  const top: Record<string, number> = {}
  const boxes: { id: string; row: number; x: number; width: number }[] = []
  const centers: Record<string, number> = {}
  let row = 0

  layers.forEach((layer, index) => {
    const ids = new Set(layer.map((task) => task.id))
    const bands = chunks(layer, perBand)
    bands.forEach((band, bandIndex) => {
      if (index === 0 || bandIndex > 0) {
        canvas.write(row, 0, truncateWidth(input.layerLabel(index), width), "header")
        row += 1
      }
      const start = Math.max(0, Math.floor((width - (band.length * nodeWidth + (band.length - 1) * gap)) / 2))
      band.forEach((task, nodeIndex) => {
        const x = start + nodeIndex * (nodeWidth + gap)
        drawNode(canvas, row, x, nodeWidth, task, input.vcsLabel)
        boxes.push({ id: task.id, row, x, width: nodeWidth })
        centers[task.id] = x + Math.floor(nodeWidth / 2)
        top[task.id] = row
      })
      row += 3
    })

    if (index === layers.length - 1) return
    const next = layers[index + 1]!
    const exact = perBand >= layer.length && perBand >= next.length
    let labelLimit: number
    if (exact) {
      const nextStart = Math.max(0, Math.floor((width - (next.length * nodeWidth + (next.length - 1) * gap)) / 2))
      labelLimit = Math.max(0, nextStart + Math.floor(nodeWidth / 2) - 2)
      next.forEach((task, taskIndex) => {
        const childX = nextStart + taskIndex * (nodeWidth + gap) + Math.floor(nodeWidth / 2)
        task.dependsOn.forEach((dependency) => {
          const parentX = centers[dependency]
          if (parentX === undefined || !ids.has(dependency)) return
          drawEdge(canvas, row - 1, parentX, row, childX)
        })
      })
    } else {
      const center = Math.floor(width / 2)
      labelLimit = Math.max(0, center - 2)
      const lastBand = chunks(layer, perBand).at(-1) ?? []
      drawBus(
        canvas,
        row - 1,
        lastBand.flatMap((task) => (centers[task.id] === undefined ? [] : [centers[task.id]!])),
        row,
        center,
      )
    }
    if (labelLimit > 0) canvas.write(row + 1, 0, truncateWidth(input.layerLabel(index + 1), labelLimit), "header")
    row += 2
  })

  const ranges = new Map<number, TaskChartNodeRange[]>()
  boxes.forEach((box) => {
    for (let line = box.row; line < box.row + 3; line++) {
      const list = ranges.get(line) ?? []
      list.push({ id: box.id, start: box.x, end: box.x + box.width - 1 })
      ranges.set(line, list)
    }
  })

  return {
    width,
    rows: canvas.toRows(row, ranges),
    top,
  }
}

class Canvas {
  readonly rows: DraftCell[][]

  constructor(readonly width: number) {
    this.rows = []
  }

  cell(row: number, column: number) {
    if (column < 0 || column >= this.width) return undefined
    return this.rows[row]?.[column]
  }

  set(row: number, column: number, text: string, part: TaskChartPart, extra?: Omit<DraftCell, "text" | "part">) {
    if (column < 0 || column >= this.width) return
    const line = (this.rows[row] ??= [])
    line[column] = { text, part, ...extra }
  }

  write(row: number, column: number, text: string, part: TaskChartPart, extra?: Omit<DraftCell, "text" | "part">) {
    let x = column
    for (const grapheme of graphemes(text)) {
      const width = stringWidth(grapheme)
      if (width <= 0) {
        const previous = this.cell(row, x - 1)
        if (previous)
          this.set(row, x - 1, previous.text + grapheme, previous.part, {
            status: previous.status,
            nodeID: previous.nodeID,
            mask: previous.mask,
          })
        continue
      }
      this.set(row, x, grapheme, part, extra)
      for (let offset = 1; offset < width; offset++) this.set(row, x + offset, "", part, extra)
      x += width
    }
    return x
  }

  fill(
    row: number,
    column: number,
    count: number,
    text: string,
    part: TaskChartPart,
    extra?: Omit<DraftCell, "text" | "part">,
  ) {
    for (let offset = 0; offset < count; offset++) this.set(row, column + offset, text, part, extra)
  }

  direction(row: number, column: number, direction: number) {
    const existing = this.cell(row, column)
    if (existing && existing.part !== "edge") return
    const mask = (existing?.mask ?? 0) | direction
    this.set(row, column, LINES[mask] ?? "│", "edge", { mask })
  }

  toRows(height: number, ranges: ReadonlyMap<number, ReadonlyArray<TaskChartNodeRange>>): TaskChartRow[] {
    return Array.from({ length: height }, (_, row) => ({
      cells: Array.from(
        { length: this.width },
        (_, column) => this.rows[row]?.[column] ?? { text: " ", part: "muted" },
      ),
      nodes: [...(ranges.get(row) ?? [])],
    }))
  }
}

function drawNode(
  canvas: Canvas,
  row: number,
  column: number,
  width: number,
  node: TaskNode,
  vcsLabel?: (node: TaskNode) => string,
) {
  const style = { status: node.status, nodeID: node.id }
  const inner = Math.max(1, width - 4)
  const label = truncateWidth(`${statusMarker(node.status)} ${node.id}`, inner)
  canvas.set(row, column, "┌", "border", style)
  canvas.set(row, column + 1, " ", "border", style)
  const labelEnd = canvas.write(row, column + 2, label, "marker", style)
  const topLabelWidth = Math.max(0, labelEnd - column - 2)
  canvas.set(row, column + 2 + topLabelWidth, " ", "border", style)
  canvas.fill(row, column + 3 + topLabelWidth, Math.max(0, width - 4 - topLabelWidth), "─", "border", style)
  canvas.set(row, column + width - 1, "┐", "border", style)

  canvas.set(row + 1, column, "│", "border", style)
  canvas.set(row + 1, column + 1, " ", "title", style)
  const title = truncateWidth(node.title, Math.max(0, width - 4))
  const titleEnd = canvas.write(row + 1, column + 2, title, "title", style)
  canvas.fill(row + 1, titleEnd, Math.max(0, column + width - 2 - titleEnd), " ", "title", style)
  canvas.set(row + 1, column + width - 2, " ", "border", style)
  canvas.set(row + 1, column + width - 1, "│", "border", style)

  const status = truncateWidth(statusLabel(node.status), inner)
  const vcsText = vcsLabel?.(node)
  const vcsWidth = inner - stringWidth(status) - 3
  const vcs = vcsText && vcsWidth > 0 ? truncateWidth(vcsText, vcsWidth) : undefined
  canvas.set(row + 2, column, "└", "border", style)
  canvas.set(row + 2, column + 1, " ", "border", style)
  let labelWidth = 0
  const statusEnd = canvas.write(row + 2, column + 2, status, "status", style)
  labelWidth = Math.max(0, statusEnd - column - 2)
  if (vcs) {
    const separatorEnd = canvas.write(row + 2, column + 2 + labelWidth, " · ", "border", style)
    labelWidth = separatorEnd - column - 2
    const vcsEnd = canvas.write(row + 2, column + 2 + labelWidth, vcs, "vcs", style)
    labelWidth = Math.max(0, vcsEnd - column - 2)
  }
  canvas.set(row + 2, column + 2 + labelWidth, " ", "border", style)
  canvas.fill(row + 2, column + 3 + labelWidth, Math.max(0, width - 4 - labelWidth), "─", "border", style)
  canvas.set(row + 2, column + width - 1, "┘", "border", style)
}

function drawEdge(canvas: Canvas, parentBottom: number, parentX: number, busRow: number, childX: number) {
  for (let row = parentBottom + 1; row <= busRow; row++) canvas.direction(row, parentX, UP | (row < busRow ? DOWN : 0))
  const from = Math.min(parentX, childX)
  const to = Math.max(parentX, childX)
  for (let column = from; column <= to; column++)
    canvas.direction(busRow, column, (column > from ? LEFT : 0) | (column < to ? RIGHT : 0))
  canvas.direction(busRow, childX, DOWN)
  canvas.set(busRow + 1, childX, "▼", "edge")
}

function drawBus(canvas: Canvas, parentBottom: number, parents: ReadonlyArray<number>, busRow: number, center: number) {
  for (const parent of parents) {
    for (let row = parentBottom + 1; row <= busRow; row++) canvas.direction(row, parent, UP | (row < busRow ? DOWN : 0))
    const from = Math.min(parent, center)
    const to = Math.max(parent, center)
    for (let column = from; column <= to; column++)
      canvas.direction(busRow, column, (column > from ? LEFT : 0) | (column < to ? RIGHT : 0))
  }
  canvas.direction(busRow, center, DOWN)
  canvas.set(busRow + 1, center, "▼", "edge")
}

function chunks<T>(items: ReadonlyArray<T>, size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
