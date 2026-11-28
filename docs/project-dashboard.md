# Project dashboard

A persistent top-level tab bar sits above the main content (not in the session
sidebar) with two tabs: **Chat** and **Dashboard**. It stays visible across
sessions and is hidden on plugin routes, fullscreen panels, and modal dialogs.
The selected tab is stored in the TUI workspace store and restored on restart.

The tab bar lives in `packages/tui/src/component/tab-bar.tsx`; the dashboard
lives in `packages/tui/src/component/dashboard.tsx`.

## Switching tabs

- `alt+1` selects Chat, `alt+2` selects Dashboard.
- `/dashboard` opens Dashboard. `/stats` is an alias that opens the same tab;
  the old full-screen `/stats` plugin route was removed.

## Dashboard

The dashboard reports usage across **all projects**, not just the current
location. The default range is the last **30 days**; select 7d, 30d, 90d, or
All with the range selector or `1`–`4`.

| Card            | Contents                                                           |
| --------------- | ------------------------------------------------------------------ |
| Overview        | Tokens, cost, sessions, prompts, and steps for the selected range.  |
| Activity        | Calendar of daily activity.                                        |
| Metrics         | Subagents, prompts, steps, active days, streak, and tool calls.    |
| Top models      | Most-used models.                                                  |
| Recent sessions | Latest sessions; select one to open it in Chat.                    |

| Key       | Action                                                       |
| --------- | ------------------------------------------------------------ |
| `1`–`4`   | Select the 7d / 30d / 90d / All range.                       |
| `↑` / `↓` | Move through the recent sessions list.                       |
| `Enter`   | Switch to Chat and open the selected recent session.         |
| `r`       | Refresh the dashboard data.                                  |
| `esc`     | Return to Chat.                                              |

## Experiment gate

The feature is gated by the `project-dashboard` experiment
(`experimental.project-dashboard`), enabled by default in the TUI. Toggle it in
**Settings → Features** or the Experiments dialog. The registry is in
`packages/tui/src/component/features.ts`. With the gate off, the tab bar and
dashboard are hidden.

## Data sources

- `experimental.session.stats` with `tools: "summary"` and no `project`
  argument, so the totals cover all projects.
- `session.list` without `directory`, for recent sessions across projects.

## Storybook

Run the fixture-driven story from a development worktree:

```bash
OPENCODE_STORY=project-dashboard bun run dev:live
```

Story keys: `1`–`4` range, `l` loading, `e` empty, `x` error, `w` narrow/wide
layout, `↑`/`↓` and `Enter` recent sessions, `r` refresh, `Shift+r` reset, and
`esc` back.
