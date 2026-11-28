import type { SessionInfo, SessionStatsInfo } from "@opencode/client"
import { TokenUsage } from "@opencode/schema/token-usage"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import {
  dashboardCalendar,
  dashboardModelRows,
  dashboardRanges,
  dashboardTotals,
  defaultDashboardRange,
  formatCost,
  formatPercent,
  formatTokens,
  loadDashboardStats,
  loadRecentSessions,
  type DashboardRange,
} from "../feature-plugins/system/dashboard-data"
import { tint } from "../theme/color"

const digits: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  ".": ["0", "0", "0", "0", "1"],
  K: ["101", "110", "100", "110", "101"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  B: ["110", "101", "110", "101", "110"],
  T: ["111", "010", "010", "010", "010"],
}

const fallbackDigit = ["000", "000", "000", "000", "000"]

function HeroDigits(props: { value: string; width: number; theme: ResolvedTheme }) {
  const known = () => Array.from(props.value).every((char) => digits[char] !== undefined)
  const letters = () => Array.from(props.value).map((char) => digits[char] ?? fallbackDigit)
  const large = () =>
    known() && letters().reduce((sum, char) => sum + char[0].length * 2 + 2, -2) <= props.width

  return (
    <Show
      when={large()}
      fallback={
        <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
          {props.value}
        </text>
      }
    >
      <box>
        <For each={[0, 1, 2, 3, 4]}>
          {(row) => (
            <text fg={props.theme.text.base} selectable={false}>
              {letters()
                .map((char) => char[row].replaceAll("1", "██").replaceAll("0", "  "))
                .join("  ")}
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

function ActivityCalendar(props: { stats: SessionStatsInfo; width: number; theme: ResolvedTheme }) {
  const calendar = createMemo(() =>
    dashboardCalendar(props.stats, Math.max(1, Math.min(52, Math.floor((props.width - 8) / 2)))),
  )
  const shades = createMemo(() => [
    props.theme.text.muted,
    ...[0.3, 0.5, 0.75, 1].map((alpha) =>
      tint(props.theme.background.base, props.theme.categorical[0][200], alpha),
    ),
  ])

  return (
    <box>
      <text fg={props.theme.text.muted}>
        {"    " +
          calendar()
            .months.map((month) => (month.label.length <= month.span * 2 ? month.label : "").padEnd(month.span * 2))
            .join("")}
      </text>
      <For each={["M", "T", "W", "T", "F", "S", "S"]}>
        {(day, index) => (
          <box flexDirection="row" height={1}>
            <text fg={props.theme.text.muted}>{day + "   "}</text>
            <For each={calendar().weeks}>
              {(week) => {
                const level = () => week[index()].level
                return (
                  <text fg={shades()[Math.max(0, level())]} selectable={false}>
                    {level() < 0 ? "  " : level() === 0 ? "· " : "■ "}
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </For>
      <Show when={calendar().clipped}>
        <text fg={props.theme.text.muted}>Earlier activity is clipped to the last {calendar().weeks.length} weeks</text>
      </Show>
    </box>
  )
}

function Card(props: { title: string; theme: ResolvedTheme; children: JSX.Element }) {
  return (
    <box
      flexDirection="column"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={props.theme.background.raised.base}
    >
      <text fg={props.theme.text.muted} attributes={TextAttributes.BOLD}>
        {props.title.toUpperCase()}
      </text>
      {props.children}
    </box>
  )
}

function formatUpdated(timestamp: number) {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60_000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(timestamp)
}

export type ProjectDashboardViewProps = {
  theme: ResolvedTheme
  stats?: SessionStatsInfo
  sessions: readonly SessionInfo[]
  range: DashboardRange
  width: number
  loading: boolean
  error?: unknown
  onRangeChange: (range: DashboardRange) => void
  onRefresh: () => void
  onOpenSession: (sessionID: string) => void
  onClose?: () => void
}

/** Presentational dashboard. All data arrives through props so the storybook renders the real UI. */
export function ProjectDashboardView(props: ProjectDashboardViewProps) {
  const [selected, setSelected] = createSignal(0)
  const wide = () => props.width >= 100
  const totals = createMemo(() => (props.stats ? dashboardTotals(props.stats) : undefined))
  const models = createMemo(() => (props.stats ? dashboardModelRows(props.stats).slice(0, 5) : []))
  const metrics = createMemo(() => {
    const value = totals()
    if (!value) return []
    return [
      { label: "subagents", value: formatTokens(value.subagents) },
      { label: "prompts", value: formatTokens(value.prompts) },
      { label: "steps", value: formatTokens(value.steps) },
      { label: "active days", value: formatTokens(value.activeDays) },
      { label: "streak", value: `${value.streak} days` },
      { label: "tool calls", value: formatTokens(value.toolCalls) },
    ]
  })
  const rangeLabels: Record<DashboardRange, string> = {
    "7d": "7d",
    "30d": "30d",
    "90d": "90d",
    all: "All",
  }
  const openSelected = () => {
    const session = props.sessions[selected()]
    if (session) props.onOpenSession(session.id)
  }

  useKeyboard((event) => {
    if (event.ctrl || event.meta || event.option || event.super || event.hyper || event.shift) return
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.name === "escape") {
      handled()
      props.onClose?.()
      return
    }
    const rangeIndex = dashboardRanges.findIndex(
      (_, index) => event.name === String(index + 1) || event.sequence === String(index + 1),
    )
    if (rangeIndex >= 0) {
      handled()
      props.onRangeChange(dashboardRanges[rangeIndex])
      return
    }
    if (event.name === "r") {
      handled()
      props.onRefresh()
      return
    }
    if (props.sessions.length === 0) return
    if (event.name === "up") {
      handled()
      setSelected((index) => (index + props.sessions.length - 1) % props.sessions.length)
      return
    }
    if (event.name === "down") {
      handled()
      setSelected((index) => (index + 1) % props.sessions.length)
      return
    }
    if (event.name === "return") {
      handled()
      openSelected()
    }
  })

  const header = () => (
    <box flexDirection="row" alignItems="center" gap={2} flexWrap="wrap">
      <text fg={props.theme.text.base} attributes={TextAttributes.BOLD}>
        All projects
      </text>
      <box flexGrow={1} />
      <For each={dashboardRanges}>
        {(range) => (
          <box
            backgroundColor={
              props.range === range
                ? props.theme.background.action.primary.selected
                : props.theme.background.raised.base
            }
            onMouseUp={() => props.onRangeChange(range)}
          >
            <text fg={props.range === range ? props.theme.text.action.primary.selected : props.theme.text.muted}>
              {` ${rangeLabels[range]} `}
            </text>
          </box>
        )}
      </For>
      <text
        fg={props.theme.text.action.secondary.base}
        onMouseUp={props.onRefresh}
      >
        {props.loading ? " refreshing…" : " r refresh "}
      </text>
    </box>
  )

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      gap={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      backgroundColor={props.theme.background.base}
    >
      {header()}
      <Show when={props.error} fallback={<box flexGrow={1} minHeight={0} />}>
        {(error) => (
          <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center" flexDirection="column" gap={1}>
            <text fg={props.theme.text.feedback.error.base}>Could not load project statistics.</text>
            <text fg={props.theme.text.feedback.error.muted}>{String(error())}</text>
            <text fg={props.theme.text.action.primary.base} onMouseUp={props.onRefresh}>
              retry
            </text>
          </box>
        )}
      </Show>
      <Show when={!props.error && props.loading}>
        <box flexGrow={1} minHeight={0} alignItems="center" justifyContent="center">
          <text fg={props.theme.text.feedback.info.base}>Reading project activity…</text>
        </box>
      </Show>
      <Show when={!props.error && !props.loading && props.stats && totals() ? props.stats : undefined} keyed>
        {(stats) => (
          <scrollbox flexGrow={1} minHeight={0}>
            <box flexDirection={wide() ? "row" : "column"} gap={2}>
              <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
                <Card title="Overview" theme={props.theme}>
                  <box flexDirection="column" alignItems={wide() ? "flex-start" : "center"}>
                    <HeroDigits
                      value={formatTokens(totals()!.tokens)}
                      width={wide() ? 44 : Math.max(12, props.width - 8)}
                      theme={props.theme}
                    />
                    <text fg={props.theme.text.muted}>TOKENS</text>
                  </box>
                  <text fg={props.theme.text.base}>
                    {formatCost(totals()!.cost)} · {formatTokens(totals()!.sessions)} sessions ·{" "}
                    {formatTokens(totals()!.prompts)} prompts · {formatTokens(totals()!.steps)} steps
                  </text>
                </Card>
                <Card title="Activity" theme={props.theme}>
                  <ActivityCalendar stats={stats} width={props.width} theme={props.theme} />
                </Card>
                <Card title="Metrics" theme={props.theme}>
                  <box flexDirection="row" flexWrap="wrap" columnGap={2}>
                    <For each={metrics()}>
                      {(metric) => (
                        <text fg={props.theme.text.muted}>
                          <span style={{ fg: props.theme.text.base }}>{metric.value}</span> {metric.label}
                        </text>
                      )}
                    </For>
                  </box>
                </Card>
              </box>
              <box flexDirection="column" gap={1} flexGrow={1} minWidth={0}>
                <Card title="Models" theme={props.theme}>
                  <Show
                    when={models().length > 0}
                    fallback={<text fg={props.theme.text.muted}>No model usage in this range.</text>}
                  >
                    <For each={models()}>
                      {(model) => (
                        <text fg={props.theme.text.muted} wrapMode="none">
                          {model.label.padEnd(wide() ? 30 : 22).slice(0, wide() ? 30 : 22)}
                          <span style={{ fg: props.theme.text.base }}>{model.tokensLabel.padStart(8)}</span>
                          <span style={{ fg: props.theme.text.base }}>{model.costLabel.padStart(10)}</span>
                          <span style={{ fg: props.theme.text.action.primary.base }}>
                            {formatPercent(model.tokens, totals()!.tokens).padStart(5)}
                          </span>
                        </text>
                      )}
                    </For>
                  </Show>
                </Card>
                <Card title="Recent sessions" theme={props.theme}>
                  <Show
                    when={props.sessions.length > 0}
                    fallback={<text fg={props.theme.text.muted}>No sessions yet in this project.</text>}
                  >
                    <For each={props.sessions.slice(0, 8)}>
                      {(session, index) => (
                        <box
                          flexDirection="row"
                          gap={1}
                          backgroundColor={
                            selected() === index()
                              ? props.theme.background.action.primary.focused
                              : props.theme.background.raised.high
                          }
                          onMouseUp={() => {
                            setSelected(index())
                            props.onOpenSession(session.id)
                          }}
                        >
                          <text fg={props.theme.text.action.primary.base} wrapMode="none">
                            {selected() === index() ? "›" : " "}
                          </text>
                          <text fg={props.theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                            {session.title ?? "(untitled)"}
                          </text>
                          <text fg={props.theme.text.muted} wrapMode="none">
                            {path.basename(session.location.directory)}
                          </text>
                          <text fg={props.theme.text.muted} wrapMode="none">
                            {formatCost(session.cost)} · {formatTokens(TokenUsage.total(session.tokens))}
                          </text>
                          <text fg={props.theme.text.muted} wrapMode="none">
                            {formatUpdated(session.time.updated)}
                          </text>
                        </box>
                      )}
                    </For>
                  </Show>
                </Card>
                <Show when={totals()!.tokens === 0 && props.sessions.length === 0}>
                  <text fg={props.theme.text.feedback.info.muted}>
                    No activity in this range. Start a session or pick a longer range.
                  </text>
                </Show>
              </box>
            </box>
          </scrollbox>
        )}
      </Show>
    </box>
  )
}

/** Container: loads all-project stats and recent sessions for the selected range. */
export function ProjectDashboard(props: { onOpenSession?: (sessionID: string) => void; onClose?: () => void }) {
  const client = useClient()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const [range, setRange] = createSignal<DashboardRange>(defaultDashboardRange)
  const [refresh, setRefresh] = createSignal(0)
  const [stats, { refetch: refetchStats }] = createResource(
    () => ({ range: range(), refresh: refresh() }),
    ({ range }) => loadDashboardStats(client.api, { range }),
  )
  const [sessions, { refetch: refetchSessions }] = createResource(
    () => refresh(),
    () => loadRecentSessions(client.api, 8),
  )
  const refreshAll = () => {
    setRefresh((value) => value + 1)
    void refetchStats()
    void refetchSessions()
  }

  return (
    <ProjectDashboardView
      theme={theme}
      stats={stats()}
      sessions={sessions() ?? []}
      range={range()}
      width={dimensions().width}
      loading={stats.loading || sessions.loading}
      error={stats.error ?? sessions.error}
      onRangeChange={setRange}
      onRefresh={refreshAll}
      onOpenSession={(sessionID) => props.onOpenSession?.(sessionID)}
      onClose={props.onClose}
    />
  )
}
