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
    { "id": "build", "title": "Implement it", "status": "active", "dependsOn": ["design"] },
    { "id": "verify", "title": "Verify on CI", "status": "pending", "dependsOn": ["build"] }
  ]
}
```

Every call replaces the previous graph. IDs must be unique, dependencies must exist in
the same graph, and cycles are rejected. A graph is limited to 50 tasks.

The viewer reads the latest completed `taskwrite` call from the session transcript.
That keeps one durable source of truth and lets the view update with ordinary message
events; there is no second store to keep in sync. Sessions that predate the tool fall
back to the latest `todowrite` list, without dependencies.

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
| `/tasks`, `/taskgraph` | Open from the prompt |
| `↑` / `↓`, `j` / `k` | Select a node |
| `pageup` / `pagedown` | Move by one page |
| `tab`, `←` / `→` | Switch between tasks and execution |
| `enter` | Open the selected subagent session |
| `r` | Refresh the goal and session state |
| `q`, `esc` | Close |

## Implementation notes

- Declared tasks come from `TaskGraph.latest(...)` in `@opencode/schema/task-graph`.
- Observed nodes are derived in `packages/tui/src/util/task-graph.ts`; they are never
  persisted.
- The TUI subscribes to the existing data store, so updates are event-driven. The view
  preserves the selected node ID and only scrolls when the selection leaves the
  viewport.
- Both panels scroll vertically only. Long titles are truncated rather than adding a
  horizontal scrollbar.
