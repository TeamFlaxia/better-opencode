# better-opencode

A focused fork of [opencode](https://github.com/anomalyco/opencode) for developers who want the coding agent to understand the codebase, respect a budget, and verify its own work.

> better-opencode is an independent fork and is not affiliated with Anomaly Innovations. OpenCode is a trademark of Anomaly Innovations, Inc. The fork keeps the upstream runtime and the `@opencode/*` package namespace so that upstream changes can be merged continuously.

## Status

Early development. better-opencode is a TUI-first fork: the desktop app and web UI are intentionally removed so the terminal interface is the only client. The runtime is currently upstream opencode v2; fork-specific features are being built incrementally on `main`.

- `main` … better-opencode development. Fork features land here.
- `upstream` … upstream mirror. Do not commit fork work here.
- `origin/upstream` … upstream `anomalyco/opencode` `dev`, used for synchronization.

See the [roadmap](docs/roadmap.md) and the [feature proposals](docs/README.md). Most design notes are written in Japanese.

## What we are building

| Area | Proposal | Status |
| --- | --- | --- |
| Code understanding | Local symbol index, references, call graph, impact analysis (`code_index`) | Proposed |
| Verification | Related-test selection, automatic test runs, failures fed back to the agent | Proposed |
| Safety | Named checkpoints and one-command restore of files and conversation position | Proposed |
| Cost control | Session / daily token and cost budgets with soft warnings and hard stops | Proposed |
| Parallelism | Worktree-isolated subagents with a consolidated diff review | Proposed |
| Incremental | Session search and export, prompt-injection defenses, role-based model routing | Proposed |

Details: [docs/features](docs/features/).

## Development

Requirements: Bun 1.4.4 (pinned in `.bun-version`). To install it:

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4"
```

Then install dependencies and start the dev TUI:

```bash
bun install
bun run dev            # V2 CLI and TUI against the local build
bun run dev:live       # development TUI against the installed opencode service
bun run check          # lint + typecheck
```

Tests run from the package that owns them, never from the repository root:

```bash
cd packages/core
bun run test
bun typecheck
```

See [docs/development.md](docs/development.md) for the repository layout, the upstream sync workflow, and the rules for adding features.

## Working on the fork

Create a short feature branch from `main`:

```bash
git switch main
git switch -c code-index
```

Use conventional commit and PR titles such as `feat(core): add symbol index` or `docs: update roadmap`.

New behavior starts experimental:

- configuration under `experimental.*`
- HTTP under `/api/experimental/...` with `experimental.<group>.<method>` identifiers
- SDK methods as `client.experimental.<group>.<method>`

Follow the dependency direction `Schema` → `Core` / `Protocol` → `Server`. Client code must not import `Core` or `Server`. After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`.

This fork does not use Changesets. Do not add `.changeset` files.

## Keeping up with upstream

```bash
git fetch origin
git switch main
git merge origin/upstream
```

Resolve conflicts in favor of this fork's features while keeping upstream structure. Do not rewrite `upstream`; it is the clean upstream reference.

## Releases

Push a tag to build the CLI for every supported target and publish a GitHub Release:

```bash
git tag v2.2.5-better.1
git push origin v2.2.5-better.1
```

Tags must look like `v<major>.<minor>.<patch>[-prerelease]` and point to a commit on `main`. See [docs/development.md](docs/development.md#リリース) for the jobs and the asset layout.

## Documentation

- [docs/README.md](docs/README.md) — fork policy, current feature inventory, proposal index
- [docs/roadmap.md](docs/roadmap.md) — priorities, phases, metrics
- [docs/development.md](docs/development.md) — setup, branch workflow, upstream sync, verification
- [docs/features](docs/features/) — individual feature designs
- [AGENTS.md](AGENTS.md) — implementation and style rules

## License

MIT. See [LICENSE](LICENSE).
