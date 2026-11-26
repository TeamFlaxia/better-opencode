import { describe, expect, test } from "bun:test"
import { layoutTaskChart } from "../../src/util/task-graph-chart"
import type { TaskNode } from "../../src/util/task-graph"

const layers = (layer: number) => (layer === 0 ? "Ready to start" : `Depends on layer ${layer}`)

function node(overrides: Partial<TaskNode> & Pick<TaskNode, "id" | "title" | "layer">): TaskNode {
  return { kind: "task", status: "pending", dependsOn: [], ...overrides }
}

function lines(chart: ReturnType<typeof layoutTaskChart>) {
  return chart.rows.map((row) => row.cells.map((cell) => cell.text).join(""))
}

describe("task graph chart", () => {
  test("draws boxed tasks and an arrow between dependency layers", () => {
    const chart = layoutTaskChart({
      tasks: [
        node({ id: "design", title: "Design the graph", status: "done", layer: 0 }),
        node({ id: "build", title: "Build the view", dependsOn: ["design"], layer: 1 }),
      ],
      width: 70,
      layerLabel: layers,
    })

    const frame = lines(chart)
    expect(frame.some((line) => line.includes("┌ [✓] design"))).toBe(true)
    expect(frame.some((line) => line.includes("│ Design the graph │"))).toBe(true)
    expect(frame.some((line) => line.includes("└ done"))).toBe(true)
    expect(frame.some((line) => line.includes("▼"))).toBe(true)
    expect(chart.top.design).toBe(1)
    expect(chart.top.build).toBe(6)
  })

  test("splits and merges edges when a layer branches", () => {
    const chart = layoutTaskChart({
      tasks: [
        node({ id: "design", title: "Design", status: "done", layer: 0 }),
        node({ id: "a", title: "First branch", dependsOn: ["design"], layer: 1 }),
        node({ id: "b", title: "Second branch", dependsOn: ["design"], layer: 1 }),
        node({ id: "verify", title: "Verify", dependsOn: ["a", "b"], layer: 2 }),
      ],
      width: 80,
      layerLabel: layers,
    })

    const frame = lines(chart)
    expect(frame.some((line) => line.includes("┴"))).toBe(true)
    expect(frame.some((line) => line.includes("┬"))).toBe(true)
    expect(frame.filter((line) => line.includes("▼")).length).toBe(2)
  })

  test("wraps a wide layer into continuation bands that fit the pane", () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      node({ id: `task-${index + 1}`, title: `Task ${index + 1}`, layer: 0 }),
    )
    const chart = layoutTaskChart({ tasks, width: 30, layerLabel: layers })

    expect(chart.rows.every((row) => row.cells.length === 30)).toBe(true)
    expect(lines(chart).filter((line) => line.includes("Ready to start")).length).toBeGreaterThan(1)
    for (const task of tasks) expect(chart.top[task.id]).toBeDefined()
  })

  test("keeps the vcs badge when the label must be truncated", () => {
    const chart = layoutTaskChart({
      tasks: [
        node({
          id: "design",
          title: "Design the graph",
          status: "done",
          layer: 0,
          vcs: {
            change: "znnsty",
            commit: "8f3a1c2",
            bookmarks: ["task/design"],
            description: "task(design): Design the graph",
            empty: false,
            conflict: true,
            immutable: false,
            parents: [],
            ref: "task/design",
            current: true,
          },
        }),
      ],
      width: 40,
      layerLabel: layers,
      vcsLabel: () => "! task/design",
    })

    const bottom = lines(chart).find((line) => line.includes("done"))
    expect(bottom).toContain("!")
    expect(bottom).toContain("…")
  })

  test("returns no rows for an empty graph", () => {
    expect(layoutTaskChart({ tasks: [], width: 40, layerLabel: layers })).toMatchObject({ rows: [], top: {} })
  })
})
