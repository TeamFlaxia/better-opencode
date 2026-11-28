# TUI Experiments

- Temporary UI experiments are listed in `src/component/features.ts`, with behavior gated by the matching `config.experimental` key. `src/component/dialog-experiments.tsx` and Settings → Features render that list.
- The TUI defaults enable the current experiments (`vcs-dock`, `task-graph`, `file-manager`, `client-mcp`, `new-designs`, `project-dashboard`). Keep the gate so users can turn each one off.
- The project dashboard is a full-pane dock alongside the VCS / TASKS / FILES docks, in `src/component/dashboard.tsx`. It replaces the normal chat surface while open, and `esc` closes it. It is gated by the `project-dashboard` experiment (`experimental.project-dashboard`, default on) and does not add a top-level tab.
- The Experiments framework is permanent infrastructure. Keep the registry, dialog, settings persistence, toggle handling, and UI entry point even when there are no active experiments.
- Graduating an experiment means removing only its registry entry and feature-specific gate, making that feature's behavior unconditional. Abandoning an experiment means removing its entry, gate, and experimental behavior.
- Do not remove or simplify away the reusable Experiments infrastructure because the registry is empty. An empty registry is intentional and ready for future experiments, not dead code.
