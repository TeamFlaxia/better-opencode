import type { Plugin } from "@opencode/plugin/tui"
import type { SessionInfo, SessionStatsInfo } from "@opencode/client"
import type { AbsolutePath } from "@opencode/schema"
import type { Project } from "@opencode/schema/project"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createSignal } from "solid-js"
import { ProjectDashboardView } from "../../../component/dashboard"
import { type DashboardRange } from "../dashboard-data"
import { StoryFooter } from "./footer"
import type { Story } from "./index"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 0, 31, 12)

function tokens(input = 0, output = 0, reasoning = 0, read = 0, write = 0) {
  return { input, output, reasoning, cache: { read, write } }
}

const FIXTURE_STATS: SessionStatsInfo = {
  range: { from: NOW - 30 * DAY, to: NOW },
  sessions: 24,
  subagents: 7,
  prompts: 96,
  steps: 184,
  tokens: tokens(1_240_000, 380_000, 90_000, 2_100_000, 45_000),
  cost: 12.84,
  tools: { mode: "summary", totals: { calls: 412, succeeded: 388, failed: 9, unfinished: 15 } },
  activeDays: 18,
  streak: 4,
  activity: Array.from({ length: 30 }, (_, index) => ({
    date: new Date(NOW - (29 - index) * DAY).toISOString().slice(0, 10),
    steps: (index * 7) % 13,
  })),
  models: [
    { model: { id: "sonnet-4-5", providerID: "anthropic" }, steps: 96, tokens: tokens(720_000, 210_000, 60_000, 1_200_000, 20_000), cost: 7.42 },
    { model: { id: "gpt-5", providerID: "openai" }, steps: 52, tokens: tokens(360_000, 110_000, 20_000, 600_000, 15_000), cost: 3.18 },
    { model: { id: "gemini", providerID: "google", variant: "think" }, steps: 24, tokens: tokens(120_000, 42_000, 8_000, 240_000, 6_000), cost: 1.12 },
    { model: { id: "haiku", providerID: "anthropic" }, steps: 12, tokens: tokens(40_000, 18_000, 2_000, 60_000, 4_000), cost: 0.12 },
  ],
}

const EMPTY_STATS: SessionStatsInfo = {
  ...FIXTURE_STATS,
  sessions: 0,
  subagents: 0,
  prompts: 0,
  steps: 0,
  tokens: tokens(),
  cost: 0,
  tools: { mode: "none" },
  activeDays: 0,
  streak: 0,
  activity: [],
  models: [],
}

const FIXTURE_SESSIONS: SessionInfo[] = [
  {
    id: "fixture-dashboard",
    projectID: "theia-code",
    cost: 1.24,
    tokens: tokens(42_000, 12_000, 2_000, 80_000, 1_000),
    time: { created: NOW - 3_600_000, updated: NOW - 600_000 },
    title: "Implement project dashboard",
    location: { directory: "/work/theia-code" },
  },
  {
    id: "fixture-calendar",
    projectID: "theia-code",
    cost: 0.86,
    tokens: tokens(24_000, 8_000, 0, 40_000, 500),
    time: { created: NOW - 86_400_000, updated: NOW - 7_200_000 },
    title: "Fix activity calendar clipping",
    location: { directory: "/work/theia-code" },
  },
  {
    id: "fixture-protocol",
    projectID: "opencode",
    cost: 2.31,
    tokens: tokens(90_000, 30_000, 4_000, 120_000, 2_000),
    time: { created: NOW - 3 * DAY, updated: NOW - 2 * DAY },
    title: "Regenerate SDK after protocol change",
    location: { directory: "/work/opencode" },
  },
  {
    id: "fixture-untitled",
    projectID: "opencode",
    cost: 0.04,
    tokens: tokens(1_200, 400, 0, 2_000, 0),
    time: { created: NOW - 5 * DAY, updated: NOW - 5 * DAY },
    location: { directory: "/work/opencode" },
  },
]

function fixtureProject(id: string, canonical: string, name?: string): Project.Info {
  return {
    id: id as Project.ID,
    canonical: canonical as AbsolutePath,
    name,
    time: { created: NOW - 90 * DAY, updated: NOW - DAY, active: NOW },
    sandboxes: [],
  }
}

const FIXTURE_PROJECTS: Project.Info[] = [
  fixtureProject("theia-code", "/work/theia-code", "Theia Code"),
  fixtureProject("opencode", "/work/opencode", "OpenCode"),
  fixtureProject("unnamed-playground", "/work/unnamed-playground"),
]

type StoryMode = "normal" | "loading" | "empty" | "error"

function ProjectDashboardStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [range, setRange] = createSignal<DashboardRange>("30d")
  const [mode, setMode] = createSignal<StoryMode>("normal")
  const [wide, setWide] = createSignal(true)
  const [project, setProject] = createSignal<Project.ID | undefined>(undefined)
  const [chart, setChart] = createSignal(true)
  const [message, setMessage] = createSignal("fixture data · no network requests")

  const stats = () => (mode() === "empty" ? EMPTY_STATS : FIXTURE_STATS)
  const sessions = () => (mode() === "empty" ? [] : FIXTURE_SESSIONS)
  const projectLabel = (id: Project.ID | undefined) => {
    const found = FIXTURE_PROJECTS.find((item) => item.id === id)
    return found ? (found.name ?? path.basename(found.canonical)) : "All projects"
  }

  const reset = () => {
    setRange("30d")
    setMode("normal")
    setWide(true)
    setProject(undefined)
    setChart(true)
    setMessage("reset to the default 30-day view")
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "p",
        title: "Cycle selected project",
        group: "Storybook",
        run() {
          const options = [undefined, ...FIXTURE_PROJECTS]
          const index = options.findIndex((item) => item?.id === project())
          const next = options[(index + 1) % options.length]
          setProject(next?.id)
          setMessage(`project ${projectLabel(next?.id)}`)
        },
      },
      {
        bind: "c",
        title: "Toggle token usage chart",
        group: "Storybook",
        run() {
          const next = !chart()
          setChart(next)
          setMessage(`chart ${next ? "shown" : "hidden"}`)
        },
      },
      {
        bind: "l",
        title: "Toggle loading state",
        group: "Storybook",
        run() {
          const next = mode() === "loading" ? "normal" : "loading"
          setMode(next)
          setMessage(`state ${next}`)
        },
      },
      {
        bind: "e",
        title: "Toggle empty state",
        group: "Storybook",
        run() {
          const next = mode() === "empty" ? "normal" : "empty"
          setMode(next)
          setMessage(`state ${next}`)
        },
      },
      {
        bind: "x",
        title: "Toggle error state",
        group: "Storybook",
        run() {
          const next = mode() === "error" ? "normal" : "error"
          setMode(next)
          setMessage(`state ${next}`)
        },
      },
      {
        bind: "w",
        title: "Toggle narrow or wide layout",
        group: "Storybook",
        run() {
          setWide((value) => !value)
          setMessage(wide() ? "wide two-column layout" : "narrow stacked layout")
        },
      },
      {
        bind: "shift+r",
        title: "Reset story",
        group: "Storybook",
        run: reset,
      },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
    >
      <ProjectDashboardView
        theme={theme}
        stats={stats()}
        sessions={sessions()}
        range={range()}
        width={wide() ? 120 : 76}
        loading={mode() === "loading"}
        error={mode() === "error" ? "fixture: statistics unavailable" : undefined}
        projects={FIXTURE_PROJECTS}
        project={project()}
        showChart={chart()}
        onRangeChange={(value) => {
          setRange(value)
          setMessage(`range ${value}`)
        }}
        onRefresh={() => setMessage("refreshed fixture data (no network)")}
        onOpenSession={(sessionID) => setMessage(`opened ${sessionID}`)}
        onProjectChange={(value) => {
          setProject(value)
          setMessage(`project ${projectLabel(value)}`)
        }}
        onClose={() => props.context.ui.router.navigate({ type: "plugin", name: "storybook" })}
      />
      <StoryFooter
        context={props.context}
        title="storybook / project dashboard"
        details={[
          `range ${range()}`,
          mode(),
          `project ${projectLabel(project())}`,
          `chart ${chart() ? "on" : "off"}`,
          wide() ? "wide" : "narrow",
          `width ${wide() ? 120 : 76}`,
        ]}
        message={message()}
        controls={[
          { shortcut: "1-4", label: "range" },
          { shortcut: "[ / ]", label: "project" },
          { shortcut: "p", label: "cycle project" },
          { shortcut: "c", label: "chart" },
          { shortcut: "l", label: "loading" },
          { shortcut: "e", label: "empty" },
          { shortcut: "x", label: "error" },
          { shortcut: "w", label: "narrow/wide" },
          { shortcut: "↑/↓/enter", label: "sessions" },
          { shortcut: "r", label: "refresh" },
          { shortcut: "shift+r", label: "reset" },
          { shortcut: "esc", label: "back" },
        ]}
      />
    </box>
  )
}

export const projectDashboardStory: Story = {
  id: "project-dashboard",
  title: "Project dashboard",
  render: (context) => <ProjectDashboardStory context={context} />,
}
