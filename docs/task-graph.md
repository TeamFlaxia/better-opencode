# Task graph

The task graph shows what the agent is doing as a dependency graph rather than a todo
checklist. It is experimental and disabled by default.

Enable it in `cli.json` or through the Experiments dialog:

```json
{
  "experimental": {
    "task-graph": true
  }
}
```

## What it shows

The graph has three layers:

- **Goal** — the objective of an active `/goal`, if one is set.
- **Tasks** — the declared units of work, with status and `dependsOn` links.
- **Execution** — the observed steps, tool calls, and subagents, updated in real time.

A task can be `pending`, `active`, `done`, `blocked`, or `cancelled`. The view derives
the display status:

| Display | Meaning |
| --- | --- |
| `pending` | Waiting on an unfinished dependency. |
| `ready` | Dependencies are done and the task can start. |
| `running` | The session or one of its children is executing. |
| `waiting` | A permission request or form is waiting for the user. |
| `blocked` | Declared blocked, with a reason. |
| `stalled` | Active, but nothing is running. A paused goal lands here. |
| `skipped` | The goal completed before the task did. |
| `done`, `cancelled`, `failed` | Directly from the task or the observed step/tool. |

## Where it lives

The Task graph dock sits above the VCS dock beside the tab bar. It is independent of
the VCS dock, so it still appears when the project has no repository. While the
experiment is enabled the dock is resident: it stays visible in sessions that have not
declared any tasks yet and shows `No tasks yet` until the graph arrives. The dock shows
a progress summary and the current task; click it to open the full-pane view.

The full-pane view keeps long detail values inside the Details pane by wrapping them at
the character level. Drag the divider between the task list and Details to resize the
panes; double-click the divider to restore the default widths.

The full-pane view has:

- a header with the goal objective, counts, and the current round;
- a dependency-layered task list, grouped from independent tasks down to dependents;
- an execution list of steps, tools, and subagents;
- a details pane for the selected node, including dependencies, dependents, reason,
  timing, tokens, cost, and the linked session.

## Declaring tasks

The agent declares the graph with the `taskwrite` tool:

```json
{
  "tasks": [
    { "id": "design", "title": "Design the change", "status": "done", "dependsOn": [] },
    {
      "id": "build",
      "title": "Implement it",
      "status": "active",
      "dependsOn": ["design"],
      "bookmark": "task/build",
      "change": "znnsty"
    },
    { "id": "verify", "title": "Verify on CI", "status": "pending", "dependsOn": ["build"] }
  ]
}
```

Every call replaces the previous graph. IDs must be unique, dependencies must exist in
the same graph, and cycles are rejected. A graph is limited to 50 tasks.

The viewer reads the latest completed `taskwrite` call from the session transcript.
That keeps one durable source of truth and lets the view update with ordinary message
events. Sessions that predate the tool fall back to the latest `todowrite` list, without
dependencies.

## jj integration

In a jj repository, a task may carry a `bookmark` and a `change`. The viewer resolves
them from `jj` and shows the change state next to the task:

| Badge | Meaning |
| --- | --- |
| `@` | The task's change is the current working copy. |
| `✓` | Clean change. |
| `!` | Conflict. |
| `∅` | Empty change. |
| `◇` | Immutable change. |
| `?` | The bookmark or change could not be found. |

The task details pane shows the change ID, commit ID, bookmarks, parent changes, and the
result of an on-demand ancestry check. The bookmark convention is `task/<task-id>`;
an explicit `bookmark` in taskwrite wins, and a TUI link created by an action wins when
it is newer than the taskwrite call.

TUI actions write their bindings to the small `opencode.tasklinks` store instead of
editing the transcript. Declared task status remains model-owned.

### Actions

| Key | Action |
| --- | --- |
| `space` | Open the task action menu |
| `n` | Create a change and set `task/<id>` for the task |
| `d` | Describe the linked change with the task title |
| `b` | Set or move the linked bookmark |
| `e` | Edit the linked change (switch `@`) |
| `s` | Squash the linked change into its parent |
| `a` | Abandon the linked change |
| `v` | Validate dependency changes against jj ancestry |
| `y` | Copy the change ID or bookmark |
| `o` | Open the VCS view |

Squash and abandon require confirmation. The TUI never changes a task's declared status;
ask the agent to update the graph after a mutation if the status changed.

### Planned workspaces

These phases are planned but not implemented, and the dock does not spend rows on them:

- **C1** — run one task in a `jj workspace` with a linked session.
- **C2** — run a subagent in a task workspace and report completion to the parent.
- **C3** — schedule independent tasks in parallel workspaces.

## Goal integration

`/goal` asks the model to split the objective into 2–8 tasks before starting. Each
continuation includes the current graph and asks the model to update it as work starts,
finishes, or becomes blocked. The goal reviewer still judges only the objective; it does
not own task status.

When the goal completes, unfinished tasks display as skipped. When it pauses, an active
task displays as stalled with the goal's reason.

## Keys

| Key | Action |
| --- | --- |
| `<leader>j` | Open the task graph |
| `/tasks` | Open from the prompt |
| `↑` / `↓`, `j` / `k` | Select a node |
| `pageup` / `pagedown` | Move by one page |
| `tab`, `←` / `→` | Switch between tasks and execution |
| `enter` | Open the selected subagent session |
| `space` | Open the task action menu |
| `o` | Open the VCS view |
| `y` | Copy the change ID or bookmark |
| `r` | Refresh the goal, links, and session state |
| `q`, `esc` | Close |

## Implementation notes

- Declared tasks come from `TaskGraph.latest(...)` in `@opencode/schema/task-graph`.
- Observed nodes are derived in `packages/tui/src/util/task-graph.ts`; they are never
  persisted.
- The TUI subscribes to the existing data store, so updates are event-driven. The view
  preserves the selected node ID and only scrolls when the selection leaves the
  viewport.
- TUI-created jj bindings live in `opencode.tasklinks`, keyed by session and task. The
  store is merged with the taskwrite fields using the `updatedAt` timestamp.
- jj links are resolved in one `jj log` call, with a per-reference fallback when one
  reference is malformed.
- Both panels scroll vertically only. Long titles are truncated rather than adding a
  horizontal scrollbar.
