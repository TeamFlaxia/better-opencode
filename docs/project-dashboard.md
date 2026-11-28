# Project dashboard

The project dashboard is a full-pane dock in the same family as the TASKS / VCS /
FILES docks. It is not a top-level tab: the normal session/chat surface remains
the default, and opening the dashboard replaces that surface with the dock. The
dashboard lives in
`packages/tui/src/component/dashboard.tsx`.

## Opening and closing the dock

- `/dashboard` opens the dashboard dock. `/stats` is an alias for the same dock;
  the old full-screen `/stats` plugin route was removed.
- `<leader>d` opens the dock.
- Select the **Dashboard** launcher beside the TASKS / VCS / FILES dock launchers.
- `esc` closes the dock and returns to the normal chat/session surface.

## Dashboard

By default the dashboard reports usage across **all projects**. The header's
compact project indicator shows `All projects ⇆ <current project>` and opens a
separate picker to narrow the view to one project. The default range is the last
**30 days**; select 7d, 30d, 90d, or All with the range selector or `1`–`4`.

### Project indicator and picker

The top-right of the header shows a compact indicator in the form
`All projects ⇆ <current folder project name>` — or the selected project's name
in place of the folder name when one is selected. Whichever side is currently
being viewed is highlighted/colored; the other is muted. **All projects** is
the default scope.

Clicking the `⇆` separator or pressing `p` opens a separate project picker
dialog listing **All projects** followed by every known project. Selecting a
project scopes both the statistics and the recent-session list to that project;
selecting **All projects** restores the cross-project view. The list of
projects comes from `project.list`. The old `[` / `]` project cycling keys have
been removed; use the picker instead.

Long model names are rendered readably instead of being cut mid-name: the
provider is shown in a muted style followed by the model id/variant on a
separate line, or middle-truncated on narrow terminals.

| Card            | Contents                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| Overview        | Tokens, cost, sessions, prompts, and steps for the selected range.                |
| Activity        | Calendar of daily activity.                                                      |
| Metrics         | Subagents, prompts, steps, active days, streak, and tool calls.                  |
| Top models      | Most-used models, with readable provider / model names.                          |
| Token usage     | One horizontal bar per model, sized by its share of total tokens, in theme categorical tokens (new). |
| Recent sessions | Latest sessions; open one to return to chat in that session.                     |

| Key       | Action                                                               |
| --------- | -------------------------------------------------------------------- |
| `1`–`4`   | Select the 7d / 30d / 90d / All range (default 30d).                 |
| `↑` / `↓` | Move through the recent sessions list.                               |
| `Enter`   | Open the selected recent session in chat and close the dock.         |
| `r`       | Refresh the dashboard data.                                          |
| `p`       | Open the project picker dialog (also click `⇆`).                     |
| `esc`     | Close the dock and return to the normal chat/session surface.        |

## Experiment gate

The feature is gated by the `project-dashboard` experiment
(`experimental.project-dashboard`), enabled by default in the TUI. Toggle it in
**Settings → Features** or the Experiments dialog. The registry is in
`packages/tui/src/component/features.ts`. With the gate off, the Dashboard
launcher and the opening commands are unavailable.

## Data sources

- `project.list` supplies the project picker.
- `experimental.session.stats` with `tools: "summary"` and an optional
  `project` filter: omitted for **All projects** so totals cover everything,
  set to the selected project otherwise. This needs no protocol change.
- `session.list` for recent sessions, unfiltered for **All projects** and
  scoped to the selected project's directory otherwise.

## Storybook

Run the fixture-driven story from a development worktree:

```bash
OPENCODE_STORY=project-dashboard bun run dev:live
```

Story keys: `1`–`4` range, `l` loading, `e` empty, `x` error, `w` narrow/wide
layout, `↑`/`↓` and `Enter` recent sessions, `r` refresh, `Shift+r` reset, and
`esc` closes the dock. Use the `⇆` separator or `p` to open the project picker
and exercise the all-project and per-project scopes.
