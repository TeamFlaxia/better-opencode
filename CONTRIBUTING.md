# Contributing to better-opencode

better-opencode is a fork of opencode. Upstream changes arrive on `upstream`; fork work happens on `main`. Before starting, read:

- [docs/README.md](docs/README.md) — fork policy and current feature inventory
- [docs/roadmap.md](docs/roadmap.md) — what is planned and in which order
- [AGENTS.md](AGENTS.md) — implementation, style, and verification rules

## Choose work

Prefer items already described in `docs/features` or `docs/roadmap.md`. New product ideas should be written up as a short proposal in `docs/features` before implementation, so the scope and the affected packages are clear.

Upstream-compatible fixes (bugs, performance, environment issues) are always welcome. Keep the diff small so it can be synced or upstreamed later.

## Workflow

1. Branch from `main`, not `upstream`.
2. Use a short hyphenated name with at most three words, without type prefixes: `code-index`, `budget-guardrails`, `session-search`.
3. Commit with conventional messages: `feat(core): ...`, `fix(tui): ...`, `docs: ...`, `refactor(server): ...`, `test(plugin): ...`.
4. Run the checks that cover the packages you touched.
5. Open the PR against `main`.

```bash
git switch main
git switch -c code-index
```

## Checks

From the repository root:

```bash
bun run check
```

During iteration, run the package-level commands instead of the full suite:

```bash
cd packages/core
bun typecheck
bun run test
```

Tests must run from the package directory. Running `bun test` from the repository root is blocked on purpose.

- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client` and commit the generated files.
- Do not edit generated client files by hand.
- When `bun check` and `bun run typecheck:tsc` disagree, the official TypeScript compiler is the source of truth.
- No Changesets. This repository follows its own release workflow.

## Fork rules

- Keep the `@opencode/*` package namespace. Renaming packages breaks upstream merges; revisit only when the fork stops tracking upstream.
- Keep the dependency direction: `Schema` → `Core` / `Protocol` → `Server`. `Client` may depend on `Schema` and `Protocol`, never `Core` or `Server`.
- New behavior starts experimental: `experimental.*` config, `/api/experimental/...` routes, `experimental.<group>.<method>` identifiers, and `experimental.*` plugin hooks.
- Keep durable session events minimal; derive state in projections instead of repeating it.
- Use Bun APIs where possible and avoid `any`, `try`/`catch` for control flow, and speculative abstractions.
- Read the relevant skill in `.opencode/skills` before writing tests (`unit-tests`, `tui-tests`, `app-e2e-tests`, `component-tests`).

## Syncing upstream

Never commit fork work to `upstream`.

```bash
git fetch origin
git switch main
git merge origin/upstream
```

Resolve conflicts by keeping fork features on top of the upstream structure. If a conflict is ambiguous, stop and document the decision in `docs/roadmap.md` (decision log).

## Documentation

User-facing behavior changes need a matching note in `docs/`:

- design or scope change → the relevant `docs/features/*.md`
- priority or phase change → `docs/roadmap.md`
- workflow or tooling change → `docs/development.md`

Write in the style of the surrounding document. Feature documents currently use Japanese; code, identifiers, and commands stay in English.
