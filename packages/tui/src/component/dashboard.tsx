import type { SessionInfo, SessionStatsInfo } from "@opencode/client"
import type { Project } from "@opencode/schema/project"
import { TokenUsage } from "@opencode/schema/token-usage"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js"
import { useClient } from "../context/client"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import {
  dashboardCalendar,
  dashboardModelRows,
  dashboardProjects,
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
import { useDialog } from "../ui/dialog"
import { tint } from "../theme/color"
import { Locale } from "../util/locale"
import { DialogProject } from "./dialog-project"

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

type ModelRow = ReturnType<typeof dashboardModelRows>[number]

/** Horizontal bar chart of token share, kept compact enough for narrow panes. */
function TokenUsageChart(props: {
  models: readonly ModelRow[]
  total: number
  width: number
  theme: ResolvedTheme
}) {
  const barWidth = () => {
    const reserved = 16 + 10 + 6 + 4
    return Math.max(4, Math.min(24, props.width - 8 - reserved))
  }
  const shades = createMemo(() =>
    props.theme.categorical.map((scale) => tint(props.theme.background.base, scale[200], 0.9)),
  )
  const rows = createMemo(() =>
    props.models.slice(0, 5).map((model, index) => {
      const share = props.total > 0 ? model.tokens / props.total : 0
      const filled = Math.min(barWidth(), Math.max(0, Math.round(share * barWidth())))
      return {
        model,
        filled,
        color: shades()[index % shades().length],
      }
    }),
  )

  return (
    <box flexDirection="column" gap={1}>
      <Show
        when={rows().length > 0 && props.total > 0}
        fallback={<text fg={props.theme.text.muted}>No token usage in this range.</text>}
      >
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" gap={1}>
              <text fg={props.theme.text.muted} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                {row.model.modelID}
              </text>
              <text fg={row.color} wrapMode="none" selectable={false}>
                {"█".repeat(row.filled) + "░".repeat(barWidth() - row.filled)}
              </text>
              <text fg={props.theme.text.base} wrapMode="none">
                {row.model.tokensLabel.padStart(8)}
              </text>
              <text fg={props.theme.text.action.primary.base} wrapMode="none">
                {formatPercent(row.model.tokens, props.total).padStart(4)}
              </text>
            </box>
          )}
        </For>
        <text fg={props.theme.text.faint}>
          {`0 ${"─".repeat(Math.max(1, barWidth()))} 100% · ${formatTokens(props.total)} tokens`}
        </text>
      </Show>
    </box>
  )
}

export type ProjectDashboardViewProps = {
  theme: ResolvedTheme
  stats?: SessionStatsInfo
  sessions: readonly SessionInfo[]
  range: DashboardRange
  width: number
  loading: boolean
  error?: unknown
  projects?: readonly Project.Info[]
  project?: Project.ID
  currentProject?: { id: Project.ID; canonical: string; name?: string }
  pickerOpen?: boolean
  showChart?: boolean
  onRangeChange: (range: DashboardRange) => void
  onRefresh: () => void
  onOpenSession: (sessionID: string) => void
  onProjectChange?: (project: Project.ID | undefined) => void
  onOpenProjectPicker?: () => void
  onClose?: () => void
}

/** Presentational dashboard. All data arrives through props so the storybook renders the real UI. */
export function ProjectDashboardView(props: ProjectDashboardViewProps) {
  const [selected, setSelected] = createSignal(0)
  const wide = () => props.width >= 100
  const totals = createMemo(() => (props.stats ? dashboardTotals(props.stats) : undefined))
  const models = createMemo(() => (props.stats ? dashboardModelRows(props.stats).slice(0, 5) : []))
  const projectName = (value: { canonical: string; name?: string }) => value.name ?? path.basename(value.canonical)
  const folderName = () => (props.currentProject ? projectName(props.currentProject) : "This folder")
  // The header reserves room for the range chips and refresh hint, so the name is shortened to keep one line.
  const displayName = createMemo(() => {
    if (!props.project) return folderName()
    const found = props.projects?.find((item) => item.id === props.project)
    if (found) return projectName(found)
    if (props.currentProject?.id === props.project) return folderName()
    return "Project"
  })
  const shortName = createMemo(() => Locale.truncateMiddle(displayName(), Math.max(6, props.width - 52)))
  const selectFolder = () => {
    if (props.currentProject) props.onProjectChange?.(props.currentProject.id)
    else props.onOpenProjectPicker?.()
  }
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
    if (props.pickerOpen) return
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
    if (event.name === "p" || event.sequence === "p") {
      handled()
      props.onOpenProjectPicker?.()
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
    <box flexDirection="row" alignItems="center" gap={2} flexWrap="no-wrap">
      <box flexDirection="row" alignItems="center">
        <box
          backgroundColor={
            props.project ? props.theme.background.raised.base : props.theme.background.action.primary.selected
          }
          onMouseUp={() => props.onProjectChange?.(undefined)}
        >
          <text fg={props.project ? props.theme.text.muted : props.theme.text.action.primary.selected} wrapMode="none">
            {" All projects "}
          </text>
        </box>
        <text fg={props.theme.text.muted} wrapMode="none" onMouseUp={props.onOpenProjectPicker}>
          {" ⇆ "}
        </text>
        <box
          backgroundColor={
            props.project ? props.theme.background.action.primary.selected : props.theme.background.raised.base
          }
          onMouseUp={selectFolder}
        >
          <text fg={props.project ? props.theme.text.action.primary.selected : props.theme.text.muted} wrapMode="none">
            {` ${shortName()} `}
          </text>
        </box>
      </box>
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
      <text fg={props.theme.text.action.secondary.base} onMouseUp={props.onRefresh}>
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
                    <box flexDirection="column" gap={1}>
                      <For each={models()}>
                        {(model) => (
                          <box flexDirection="column">
                            <Show when={wide()}>
                              <text fg={props.theme.text.muted} wrapMode="none">
                                {model.providerID}
                              </text>
                            </Show>
                            <box flexDirection="row" gap={1} alignItems="flex-start">
                              <text fg={props.theme.text.base} wrapMode="none" truncate flexGrow={1} minWidth={0}>
                                {wide()
                                  ? model.variant
                                    ? `${model.modelID} (${model.variant})`
                                    : model.modelID
                                  : Locale.truncateMiddle(
                                      `${model.providerID}/${model.modelID}${model.variant ? ` (${model.variant})` : ""}`,
                                      Math.max(14, Math.floor(props.width * 0.3)),
                                    )}
                              </text>
                              <text fg={props.theme.text.base} wrapMode="none">
                                {model.tokensLabel.padStart(8)}
                              </text>
                              <text fg={props.theme.text.base} wrapMode="none">
                                {model.costLabel.padStart(10)}
                              </text>
                              <text fg={props.theme.text.action.primary.base} wrapMode="none">
                                {formatPercent(model.tokens, totals()!.tokens).padStart(5)}
                              </text>
                            </box>
                          </box>
                        )}
                      </For>
                    </box>
                  </Show>
                </Card>
                <Show when={props.showChart !== false}>
                  <Card title="Token usage" theme={props.theme}>
                    <TokenUsageChart
                      models={models()}
                      total={totals()!.tokens}
                      width={wide() ? Math.floor(props.width / 2) : props.width}
                      theme={props.theme}
                    />
                  </Card>
                </Show>
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

/** Container: loads projects, stats and recent sessions for the selected range and project. */
export function ProjectDashboard(props: { onOpenSession?: (sessionID: string) => void; onClose?: () => void }) {
  const client = useClient()
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const location = useLocation()
  const dialog = useDialog()
  const [range, setRange] = createSignal<DashboardRange>(defaultDashboardRange)
  const [project, setProject] = createSignal<Project.ID | undefined>(undefined)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  const [projects] = createResource(() => dashboardProjects(client.api))
  const [stats, { refetch: refetchStats }] = createResource(
    () => ({ range: range(), project: project(), refresh: refresh() }),
    ({ range, project }) => loadDashboardStats(client.api, { range, project }),
  )
  const [sessions, { refetch: refetchSessions }] = createResource(
    () => ({ project: project(), refresh: refresh() }),
    ({ project }) => loadRecentSessions(client.api, 8, project),
  )
  const refreshAll = () => {
    setRefresh((value) => value + 1)
    void refetchStats()
    void refetchSessions()
  }
  // The location's project is a lightweight descriptor; reconcile it with the loaded project info when possible.
  const folderProject = createMemo(() => {
    const info = location.current?.project
    if (!info) return undefined
    const found = projects()?.find((item) => item.id === info.id)
    if (found) return found
    return { id: info.id as Project.ID, canonical: info.canonical }
  })
  const openProjectPicker = () => {
    setPickerOpen(true)
    dialog.replace(() => (
      <DialogProject
        projects={projects() ?? []}
        project={project()}
        onCancel={() => setPickerOpen(false)}
        onSelect={(value) => {
          setProject(value)
          setPickerOpen(false)
        }}
      />
    ))
  }

  return (
    <ProjectDashboardView
      theme={theme}
      stats={stats()}
      sessions={sessions() ?? []}
      range={range()}
      width={dimensions().width}
      loading={stats.loading || sessions.loading || projects.loading}
      error={stats.error ?? sessions.error}
      projects={projects() ?? []}
      project={project()}
      currentProject={folderProject()}
      pickerOpen={pickerOpen()}
      onProjectChange={setProject}
      onOpenProjectPicker={openProjectPicker}
      onRangeChange={setRange}
      onRefresh={refreshAll}
      onOpenSession={(sessionID) => props.onOpenSession?.(sessionID)}
      onClose={props.onClose}
    />
  )
}
