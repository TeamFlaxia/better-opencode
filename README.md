# better-opencode

English | [日本語](README.ja.md)

A focused fork of [opencode](https://github.com/anomalyco/opencode) for developers who want the coding agent to understand the codebase, respect a budget, and verify its own work.

> better-opencode is an independent fork and is not affiliated with Anomaly Innovations. OpenCode is a trademark of Anomaly Innovations, Inc. The fork keeps the upstream runtime and the `@opencode/*` package namespace so that upstream changes can be merged continuously.

## Status

Early development. better-opencode tracks upstream opencode v2 and is TUI-first: the desktop app and web UI are removed, so the terminal interface is the only client. The TUI defaults to Japanese; switch to English in **Settings → Language**.

| Branch            | Purpose                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `main`            | better-opencode development. Fork features land here.                              |
| `upstream`        | Clean mirror of upstream `anomalyco/opencode` `dev`. Do not commit fork work here. |
| `origin/upstream` | Upstream `dev`, fetched for synchronization.                                       |

## Features

The version control dock, task graph, and file manager are built in this fork. TUI tools and New designs come from upstream; this fork surfaces them in Settings and enables them by default.

The TUI enables all of these features by default. Turn each one on or off in **Settings → Features**, or from the Experiments dialog.

| Feature              | What it does                                                                                                                                                                                                                                                                                          | Docs                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Version control dock | Shows jj, Git, or Mercurial status beside the tab bar and opens a built-in version control view. Review diffs, manage bookmarks/branches, describe or split jj changes, and stage, commit, fetch, pull, or push Git changes without leaving the TUI. `lazyjj`, `jjui`, and `lazygit` remain optional. | [docs/vcs-dock.md](docs/vcs-dock.md)         |
| Task graph           | Shows the agent's tasks, dependencies, and live execution as a chart. `/divide <instruction>` splits an instruction into a task graph and works through it in dependency order. In a jj repository, tasks can carry a bookmark and change.                                                            | [docs/task-graph.md](docs/task-graph.md)     |
| File manager         | Read-only browser and preview for the current session location. Open it with `<leader>f` or `/files`.                                                                                                                                                                                                 | [docs/file-manager.md](docs/file-manager.md) |
| TUI tools            | Lets the agent open a terminal in the running TUI (requires server support).                                                                                                                                                                                                                          | —                                            |
| New designs          | Previews the redesigned TUI surfaces.                                                                                                                                                                                                                                                                 | —                                            |

Fork-specific work also includes the Japanese interface, fork-aware update checks for standalone installs, and the removal of the desktop and web clients.

## Install

Prebuilt CLI binaries are published on the [releases page](https://github.com/TeamFlaxia/better-opencode/releases). Download `opencode-<version>-<target>.tar.gz` for Linux or `.zip` for macOS and Windows, verify it against `SHA256SUMS.txt`, and put `opencode` on your `PATH`.

A curl-installed build (`~/.opencode/bin/opencode`) checks this fork's GitHub releases on `opencode upgrade`. The default update policy only notifies; set `"update": "auto"` in the global configuration to install automatically. Package-manager installs keep using the upstream update service.

To run from source, install Bun 1.4.4 (pinned in `.bun-version`):

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
bun install
bun run dev
```

## Development

```bash
bun run dev            # V2 CLI and TUI against the local build
bun run dev:live       # development TUI against the installed opencode service
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

```bash
git fetch origin
git switch main
git merge origin/upstream
```

Resolve conflicts in favor of this fork's features while keeping the upstream structure. Do not rewrite `upstream`; it is the clean upstream reference.

## Releases

Push a tag to build the CLI for every supported target and publish a GitHub Release:

```bash
git switch main
git pull
git tag v2.2.5-better.1
git push origin v2.2.5-better.1
```

Tags must look like `v<major>.<minor>.<patch>[-prerelease]`, and the tagged commit must be an ancestor of `main`. Tags containing `-` are published as prereleases. The release workflow builds 12 CLI targets, packages Linux archives as `tar.gz` and macOS/Windows archives as `zip`, and publishes them with `SHA256SUMS.txt`. See [docs/development.md](docs/development.md#リリース) for the job layout.

## Documentation

- [docs/README.md](docs/README.md) — fork policy, current feature inventory, and scope
- [docs/development.md](docs/development.md) — setup, branch workflow, upstream sync, verification, and releases
- [docs/vcs-dock.md](docs/vcs-dock.md) — built-in version control view
- [docs/task-graph.md](docs/task-graph.md) — task graph and `/divide`
- [docs/file-manager.md](docs/file-manager.md) — file browser and preview
- [AGENTS.md](AGENTS.md) — implementation and style rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow

## License

MIT. See [LICENSE](LICENSE).
