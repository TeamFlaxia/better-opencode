import type { OpenCodeClient, SessionStatsActivity, SessionStatsInfo } from "@opencode/client"
import { TokenUsage } from "@opencode/schema/token-usage"
import { activityCalendar } from "@opencode/util/activity-calendar"
import { statsNumber } from "./stats-data"

const DAY_MS = 86_400_000

export const dashboardRanges = ["7d", "30d", "90d", "all"] as const
export type DashboardRange = (typeof dashboardRanges)[number]
export const defaultDashboardRange: DashboardRange = "30d"

const rangeDays: Record<Exclude<DashboardRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

export function dashboardRangeWindow(range: DashboardRange = defaultDashboardRange, now = Date.now()) {
  if (range === "all") return { from: 0, to: now }
  return { from: now - rangeDays[range] * DAY_MS, to: now }
}

export function loadDashboardStats(
  client: OpenCodeClient,
  options: { range?: DashboardRange; timezone?: string } = {},
) {
  const { from, to } = dashboardRangeWindow(options.range)
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  return client.experimental.session.stats({ from, to, timezone, tools: "summary" })
}

export function loadRecentSessions(client: OpenCodeClient, limit: number) {
  // Omitting both directory and project lists sessions across every project.
  return client.session.list({ limit, order: "desc" }).then((response) => response.data)
}

export function formatTokens(value: number) {
  return statsNumber(value)
}

export function formatCost(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(part: number, total: number) {
  if (total <= 0) return "0%"
  return `${Math.round((part / total) * 100)}%`
}

export function dashboardTotals(stats: SessionStatsInfo) {
  const toolCalls = stats.tools.mode === "none" ? 0 : stats.tools.totals.calls
  return {
    tokens: TokenUsage.total(stats.tokens),
    cost: stats.cost,
    sessions: stats.sessions,
    subagents: stats.subagents,
    prompts: stats.prompts,
    steps: stats.steps,
    activeDays: stats.activeDays,
    streak: stats.streak,
    toolCalls,
  }
}

export function dashboardModelRows(stats: SessionStatsInfo, sort: "tokens" | "cost" = "tokens") {
  return stats.models
    .map((usage) => {
      const tokens = TokenUsage.total(usage.tokens)
      const name = `${usage.model.providerID}/${usage.model.id}`
      return {
        label: usage.model.variant ? `${name} (${usage.model.variant})` : name,
        providerID: usage.model.providerID,
        modelID: usage.model.id,
        variant: usage.model.variant,
        steps: usage.steps,
        tokens,
        cost: usage.cost,
        tokensLabel: formatTokens(tokens),
        costLabel: formatCost(usage.cost),
      }
    })
    .sort((left, right) => right[sort] - left[sort])
}

export function dashboardToolRows(stats: SessionStatsInfo) {
  if (stats.tools.mode !== "detail") return []
  return stats.tools.usage
    .map((tool) => ({
      name: tool.name,
      calls: tool.calls,
      succeeded: tool.succeeded,
      failed: tool.failed,
      unfinished: tool.unfinished,
      success: formatPercent(tool.succeeded, tool.calls),
    }))
    .sort((left, right) => right.calls - left.calls)
}

export function dashboardActivity(stats: SessionStatsInfo): readonly SessionStatsActivity[] {
  return stats.activity
}

export function dashboardCalendar(stats: SessionStatsInfo, maxWeeks: number) {
  return activityCalendar({
    activity: dashboardActivity(stats),
    from: stats.range.from,
    to: stats.range.to,
    maxWeeks,
  })
}
