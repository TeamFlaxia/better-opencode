import type { OpenCodeClient, SessionListInput, SessionStatsInfo } from "@opencode/client"
import { expect, test } from "bun:test"
import {
  dashboardActivity,
  dashboardCalendar,
  dashboardModelRows,
  dashboardRangeWindow,
  dashboardRanges,
  dashboardToolRows,
  dashboardTotals,
  defaultDashboardRange,
  formatCost,
  formatPercent,
  formatTokens,
  loadDashboardStats,
  loadRecentSessions,
} from "../../src/feature-plugins/system/dashboard-data"

const DAY = 86_400_000
const now = Date.UTC(2026, 0, 31, 12)

function tokens(input = 100, output = 50, reasoning = 10, read = 20, write = 5) {
  return { input, output, reasoning, cache: { read, write } }
}

function fixture(overrides: Partial<SessionStatsInfo> = {}): SessionStatsInfo {
  return {
    range: { from: now - 30 * DAY, to: now },
    sessions: 4,
    subagents: 2,
    prompts: 10,
    steps: 20,
    tokens: tokens(),
    cost: 1.25,
    tools: { mode: "summary", totals: { calls: 8, succeeded: 6, failed: 1, unfinished: 1 } },
    activeDays: 3,
    streak: 2,
    activity: [{ date: "2026-01-30", steps: 4 }],
    models: [
      { model: { id: "sonnet", providerID: "anthropic" }, steps: 12, tokens: tokens(80, 40, 0, 10, 0), cost: 1 },
      { model: { id: "gpt", providerID: "openai" }, steps: 8, tokens: tokens(20, 10, 10, 10, 5), cost: 0.25 },
    ],
    ...overrides,
  }
}

test("range presets cover 7/30/90/all days and default to 30", () => {
  expect(dashboardRanges).toEqual(["7d", "30d", "90d", "all"])
  expect(defaultDashboardRange).toBe("30d")
  expect(dashboardRangeWindow("7d", now)).toEqual({ from: now - 7 * DAY, to: now })
  expect(dashboardRangeWindow("30d", now)).toEqual({ from: now - 30 * DAY, to: now })
  expect(dashboardRangeWindow("90d", now)).toEqual({ from: now - 90 * DAY, to: now })
  expect(dashboardRangeWindow("all", now)).toEqual({ from: 0, to: now })
  expect(dashboardRangeWindow(undefined, now)).toEqual(dashboardRangeWindow("30d", now))
})

test("formats tokens with compact K/M/B suffixes", () => {
  expect(formatTokens(0)).toBe("0")
  expect(formatTokens(999)).toBe("999")
  expect(formatTokens(1_200)).toBe("1.2K")
  expect(formatTokens(2_500_000)).toBe("2.5M")
  expect(formatTokens(3_000_000_000)).toBe("3B")
})

test("formats costs as USD and percentages with a zero denominator guard", () => {
  expect(formatCost(0)).toBe("$0.00")
  expect(formatCost(12.5)).toBe("$12.50")
  expect(formatCost(1234.567)).toBe("$1,234.57")
  expect(formatPercent(1, 4)).toBe("25%")
  expect(formatPercent(2, 3)).toBe("67%")
  expect(formatPercent(0, 0)).toBe("0%")
})

test("totals use authoritative usage values and count tools in summary mode", () => {
  expect(dashboardTotals(fixture())).toEqual({
    tokens: 185,
    cost: 1.25,
    sessions: 4,
    subagents: 2,
    prompts: 10,
    steps: 20,
    activeDays: 3,
    streak: 2,
    toolCalls: 8,
  })
  expect(dashboardTotals(fixture({ tools: { mode: "none" } })).toolCalls).toBe(0)
})

test("model rows sort by tokens by default and by cost on request", () => {
  const rows = dashboardModelRows(fixture())
  expect(rows.map((row) => row.label)).toEqual(["anthropic/sonnet", "openai/gpt"])
  expect(rows.map((row) => row.tokens)).toEqual([130, 55])
  expect(rows.map((row) => row.tokensLabel)).toEqual(["130", "55"])
  expect(rows.map((row) => row.costLabel)).toEqual(["$1.00", "$0.25"])
  expect(rows[0].variant).toBeUndefined()

  const stats = fixture({
    models: [
      { model: { id: "a", providerID: "p", variant: "fast" }, steps: 3, tokens: tokens(40), cost: 0.1 },
      { model: { id: "b", providerID: "p" }, steps: 1, tokens: tokens(5), cost: 2 },
    ],
  })
  expect(dashboardModelRows(stats).map((row) => row.label)).toEqual(["p/a (fast)", "p/b"])
  expect(dashboardModelRows(stats, "cost").map((row) => row.label)).toEqual(["p/b", "p/a (fast)"])
})

test("tool rows come from detail usage, sort by calls, and are empty without detail", () => {
  const stats = fixture({
    tools: {
      mode: "detail",
      totals: { calls: 7, succeeded: 5, failed: 1, unfinished: 1 },
      usage: [
        { name: "read", calls: 2, succeeded: 2, failed: 0, unfinished: 0 },
        { name: "bash", calls: 5, succeeded: 3, failed: 1, unfinished: 1, durationP50: 12 },
      ],
    },
  })
  expect(dashboardToolRows(stats)).toEqual([
    { name: "bash", calls: 5, succeeded: 3, failed: 1, unfinished: 1, success: "60%" },
    { name: "read", calls: 2, succeeded: 2, failed: 0, unfinished: 0, success: "100%" },
  ])
  expect(dashboardToolRows(fixture())).toEqual([])
})

test("empty stats produce zero totals, no rows, and empty activity", () => {
  const stats = fixture({
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: tokens(0, 0, 0, 0, 0),
    cost: 0,
    tools: { mode: "none" },
    activeDays: 0,
    streak: 0,
    activity: [],
    models: [],
  })
  expect(dashboardTotals(stats)).toEqual({
    tokens: 0,
    cost: 0,
    sessions: 0,
    subagents: 0,
    prompts: 0,
    steps: 0,
    activeDays: 0,
    streak: 0,
    toolCalls: 0,
  })
  expect(dashboardModelRows(stats)).toEqual([])
  expect(dashboardToolRows(stats)).toEqual([])
  expect(dashboardActivity(stats)).toBe(stats.activity)
})

test("calendar uses the stats range and clipped activity", () => {
  const stats = fixture()
  const calendar = dashboardCalendar(stats, 4)
  expect(calendar.weeks.length).toBe(4)
  expect(calendar.clipped).toBe(true)
  expect(dashboardCalendar(fixture({ activity: [] }), 52).weeks.length).toBeGreaterThan(0)
})

type StatsInput = Parameters<OpenCodeClient["experimental"]["session"]["stats"]>[0]

test("stats loader requests the chosen range across all projects with summary tools", async () => {
  const requests: StatsInput[] = []
  const client = {
    experimental: {
      session: {
        stats: async (input: StatsInput) => {
          requests.push(input)
          return fixture()
        },
      },
    },
  } as unknown as OpenCodeClient

  const result = await loadDashboardStats(client, { range: "7d", timezone: "UTC" })
  expect(result).toEqual(fixture())
  const request = requests.at(0)
  if (!request) throw new Error("expected a stats request")
  expect(request.tools).toBe("summary")
  expect(request.timezone).toBe("UTC")
  expect(request.project).toBeUndefined()
  expect((request.to ?? 0) - (request.from ?? 0)).toBe(7 * DAY)
})

test("recent sessions loader lists newest sessions without a project or directory filter", async () => {
  const requests: SessionListInput[] = []
  const client = {
    session: {
      list: async (input: SessionListInput) => {
        requests.push(input)
        return { data: [] }
      },
    },
  } as unknown as OpenCodeClient

  expect(await loadRecentSessions(client, 5)).toEqual([])
  expect(requests).toEqual([{ limit: 5, order: "desc" }])
})
