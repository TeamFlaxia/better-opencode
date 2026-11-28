# Theia Code

English | [日本語](README.ja.md)

A focused fork of [opencode](https://github.com/anomalyco/opencode) for developers who want the coding agent to understand the codebase, respect a budget, and verify its own work.

> Theia Code (the `theia-code` project) is an independent fork and is not affiliated with Anomaly Innovations. OpenCode is a trademark of Anomaly Innovations, Inc. The fork keeps the upstream runtime and the `@opencode/*` package namespace so that upstream changes can be merged continuously. The command is `theiacode`; `opencode` remains a compatible alias. It currently tracks upstream v2.4.2.

## Status

Early development. Theia Code tracks upstream opencode v2 and is TUI-first: the desktop app and web UI are removed, so the terminal interface is the only client. The TUI defaults to Japanese; switch to English in **Settings → Language**.

| Branch            | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `main`            | Theia Code development. Fork features land here.                                   |
| `upstream`        | Clean mirror of upstream `anomalyco/opencode` `dev`. Do not commit fork work here. |
| `origin/upstream` | Upstream `dev`, fetched for synchronization.                                       |

## Features

The version control dock, task graph, and file manager are built in this fork. TUI tools and New designs come from upstream; this fork surfaces them in Settings and enables them by default.

The TUI enables all of these features by default. Turn each one on or off in **Settings → Features**, or from the Experiments dialog.

| Feature              | What it does                                                                                                                                                                                                                                                                                          | Docs                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Version control dock | Shows jj, Git, or Mercurial status beside the tab bar and opens a built-in version control view. Review diffs, manage bookmarks/branches, describe or split jj changes, and stage, commit, fetch, pull, or push Git changes without leaving the TUI. `lazyjj`, `jjui`, and `lazygit` remain optional. | [docs/vcs-dock.md](docs/vcs-dock.md)         |
| Task graph           | Shows the agent's tasks, dependencies, and live execution as a chart. `/divide <instruction>` splits an instruction into a task graph and works through it in dependency order, running independent tasks in parallel through subagents. In a jj repository, tasks can carry a bookmark and change.   | [docs/task-graph.md](docs/task-graph.md)     |
| File manager         | Read-only browser and preview for the current session location. Open it with `<leader>f` or `/files`.                                                                                                                                                                                                 | [docs/file-manager.md](docs/file-manager.md) |
| TUI tools            | Lets the agent open a terminal in the running TUI (requires server support).                                                                                                                                                                                                                          | —                                            |
| New designs          | Previews the redesigned TUI surfaces.                                                                                                                                                                                                                                                                 | —                                            |
| Project dashboard    | Adds a full-pane dashboard dock alongside the TASKS / VCS / FILES docks (not a top-level tab). It summarizes usage with an activity calendar, metrics, readable top-model names, a per-model token usage bar chart, and recent sessions, scoped to all projects by default (30-day range) or to one project via the header selector. Open it with `/dashboard` (`/stats` alias), `<leader>d`, or the Dashboard launcher; `esc` returns to chat. | [docs/project-dashboard.md](docs/project-dashboard.md) |

Model routing is also on by default: the CLI server loads `opencode-model-router@latest`, fetches it from npm, and updates it with the existing plugin update check. Disable it with `"plugins": ["-opencode-model-router"]`. See [docs/model-router.md](docs/model-router.md).

Fork-specific work also includes the Japanese interface, fork-aware update checks for standalone installs, and the removal of the desktop and web clients.

## Install

Prebuilt CLI binaries are published on the [releases page](https://github.com/TeamFlaxia/theia-code/releases). Download `opencode-<version>-<target>.tar.gz` for Linux or `.zip` for macOS and Windows, verify it against `SHA256SUMS.txt`, and put `theiacode` on your `PATH` (the `opencode` command remains available as a compatible alias).

Configuration lives in `~/.config/opencode`; on first start, a legacy `~/.config/theiacode` configuration is merged into it once.

A curl-installed build (`~/.opencode/bin/opencode`) checks this fork's GitHub releases on `theiacode upgrade`. The default update policy only notifies; set `"update": "auto"` in the global configuration to install automatically. Package-manager installs keep using the upstream update service.

To run from source, install Bun 1.4.4 (pinned in `.bun-version`):

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
bun install
bun run dev
```

## Development

```bash
bun run dev            # V2 CLI and TUI against the local build
bun run dev:live       # development TUI against the installed theiacode service
bun run check          # lint + typecheck
```

`dev:live` discovers the elected background server and injects its local credential. Pass a directory after the script to start there:

```bash
bun run dev:live /path/to/project
```

Tests run from the package that owns them, never from the repository root:

```bash
cd packages/core
bun run test
bun typecheck
```

`bun run test:fast` runs test files in parallel for local iteration; CI uses the serial `test` script. `bun run test:affected` from the repository root runs the packages affected by your changes.

Repository layout:

| Path                | Role                                                    |
| ------------------- | ------------------------------------------------------- |
| `packages/schema`   | Shared schemas, durable events, and configuration types |
| `packages/core`     | Domain logic, persistence, tools, and session execution |
| `packages/protocol` | Public HTTP API definitions                             |
| `packages/server`   | HTTP server and runtime composition                     |
| `packages/client`   | Generated client and SDK-facing types                   |
| `packages/cli`      | CLI, service lifecycle, and ACP                         |
| `packages/tui`      | Terminal UI, the only client                            |
| `packages/plugin`   | Server and TUI plugin APIs                              |
| `docs/`             | Fork design notes and operations guides                 |

See [docs/development.md](docs/development.md) for setup details, the upstream sync workflow, CI, releases, and where to add features.

## Working on the fork

Branch from `main` with a short hyphenated name of at most three words:

```bash
git switch main
git switch -c code-index
```

Use conventional commit and PR titles such as `feat(core): add symbol index` or `docs: update roadmap`. Do not use type prefixes in branch names.

New behavior starts experimental:

- configuration under `experimental.*`
- HTTP under `/api/experimental/...` with `experimental.<group>.<method>` identifiers
- SDK methods as `client.experimental.<group>.<method>`
- plugin hooks named `experimental.*`

Follow the dependency direction `Schema` → `Core` / `Protocol` → `Server`. Client code may depend on `Schema` and `Protocol`, but never on `Core` or `Server`. After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`; do not edit generated files by hand.

This fork does not use Changesets. Do not add `.changeset` files.

## Keeping up with upstream

Run the sync helper from a clean `main`:

```bash
bun run sync:upstream --tag v2.4.2   # sync up to a stable release
bun run sync:upstream                # sync up to upstream/dev
```

It fetches upstream, fast-forwards the local `upstream` mirror, merges into `main` through an `upstream-sync` branch, and stops on conflicts instead of guessing. Use `--continue` after resolving them, or `--push-mirror` to also publish the mirror to this fork's `upstream` branch. Resolve conflicts in favor of this fork's features while keeping the upstream structure. See [docs/upstream-sync.md](docs/upstream-sync.md); never rewrite `upstream` or commit fork work to it.

## Releases

Push a tag to build the CLI for every supported target and publish a GitHub Release:

```bash
git switch main
git pull
git tag v2.4.2-theia.1
git push origin v2.4.2-theia.1
```

Fork tags use the upstream semver core plus `-theia.N`; `N` restarts at 1 for each upstream base version. Tags must look like `v<major>.<minor>.<patch>[-prerelease]`, and the tagged commit must be an ancestor of `main`. Tags containing `-` are published as prereleases. The release workflow builds 12 CLI targets, packages Linux archives as `tar.gz` and macOS/Windows archives as `zip`, and publishes them with `SHA256SUMS.txt`. See [docs/development.md](docs/development.md#リリース) for the job layout.

## Documentation

- [docs/README.md](docs/README.md) — fork policy, current feature inventory, and scope
- [docs/development.md](docs/development.md) — setup, branch workflow, upstream sync, verification, and releases
- [docs/upstream-sync.md](docs/upstream-sync.md) — upstream mirror helper, conflict flow, and version tags
- [docs/vcs-dock.md](docs/vcs-dock.md) — built-in version control view
- [docs/task-graph.md](docs/task-graph.md) — task graph and `/divide`
- [docs/file-manager.md](docs/file-manager.md) — file browser and preview
- [docs/project-dashboard.md](docs/project-dashboard.md) — the usage dashboard dock (all projects by default, with a project selector)
- [docs/model-router.md](docs/model-router.md) — default model routing plugin, opt-out, and license notes
- [AGENTS.md](AGENTS.md) — implementation and style rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow

## License

MIT. See [LICENSE](LICENSE).
