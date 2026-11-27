#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
process.chdir(root)

const upstreamURL = "https://github.com/anomalyco/opencode.git"
const syncBranch = "upstream-sync"
const usage =
  "Usage: bun script/sync-upstream.ts [--tag <vX.Y.Z>] [--ref <git-ref>] [--continue] [--push-mirror] [--dry-run] [--help]"

const args = process.argv.slice(2)
const options = {
  tag: "",
  ref: "",
  continue: false,
  pushMirror: false,
  dryRun: false,
}

function usageError(message: string): never {
  console.error(`error: ${message}`)
  console.error(usage)
  process.exit(1)
}

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

for (const [index, arg] of args.entries()) {
  if (index > 0 && (args[index - 1] === "--tag" || args[index - 1] === "--ref")) continue
  if (arg === "--help" || arg === "-h") {
    console.log(usage)
    process.exit(0)
  }
  if (arg === "--continue" || arg === "--push-mirror" || arg === "--dry-run") {
    const key = arg === "--continue" ? "continue" : arg === "--push-mirror" ? "pushMirror" : "dryRun"
    if (options[key]) usageError(`Duplicate option: ${arg}`)
    options[key] = true
    continue
  }
  if (arg === "--tag" || arg === "--ref") {
    const value = args[index + 1]
    if (!value || value.startsWith("-")) usageError(`Missing value for ${arg}`)
    const key = arg === "--tag" ? "tag" : "ref"
    if (options[key]) usageError(`Duplicate option: ${arg}`)
    options[key] = value
    continue
  }
  usageError(`Unknown option or argument: ${arg}`)
}

if (options.tag && !/^v\d+\.\d+\.\d+$/.test(options.tag)) usageError(`Invalid --tag: ${options.tag} (expected vX.Y.Z)`)
if (options.ref && /\s/.test(options.ref)) usageError(`Invalid --ref: ${options.ref}`)
if (options.tag && options.ref) console.log(`note: --tag takes precedence over --ref (ignoring ${options.ref})`)

const target = options.tag || options.ref || "upstream/dev"
type GitResult = { code: number; text: string }

const plan = (command: string[]) => console.log(`+ git ${command.join(" ")}`)

async function check(command: string[]): Promise<GitResult> {
  // Dry runs still evaluate read-only checks so conditional commands are accurate.
  if (options.dryRun) plan(command)
  const result = await $`git ${command}`.quiet().nothrow()
  return { code: result.exitCode, text: result.stdout.toString().trim() }
}

async function run(command: string[], env?: Record<string, string>): Promise<GitResult> {
  if (options.dryRun) {
    plan(command)
    return { code: 0, text: "" }
  }
  const shell = env ? $`git ${command}`.env(env).nothrow() : $`git ${command}`.nothrow()
  const result = await shell
  return { code: result.exitCode, text: result.stdout.toString().trim() }
}

if (options.dryRun) {
  if (!options.continue) plan(["status", "--porcelain"])
  plan(["rev-parse", "--abbrev-ref", "HEAD"])
  if (options.continue) plan(["rev-parse", "-q", "--verify", "MERGE_HEAD"])
}
if (!options.dryRun) {
  // Resolved conflicts are staged during a merge, so porcelain status is dirty by design in --continue mode.
  if (!options.continue) {
    const status = await check(["status", "--porcelain"])
    if (status.text) fail(`Working tree is dirty; commit or stash changes first:\n${status.text}`)
  }

  const branch = await check(["rev-parse", "--abbrev-ref", "HEAD"])
  if (options.continue) {
    if (branch.text !== syncBranch) fail(`--continue requires branch ${syncBranch} (current: ${branch.text})`)
    const merging = await check(["rev-parse", "-q", "--verify", "MERGE_HEAD"])
    if (merging.code !== 0) fail(`--continue requires an in-progress merge on ${syncBranch}`)
  }
  if (!options.continue && branch.text !== "main") {
    fail(`Sync requires branch main (current: ${branch.text}); use --continue to finish a conflicted merge`)
  }
}

const remote = await check(["remote", "get-url", "upstream"])
const normalize = (url: string) => url.replace(/\/+$/, "").replace(/\.git$/, "")
if (remote.code === 0 && normalize(remote.text) !== normalize(upstreamURL)) {
  fail(`upstream remote points to ${remote.text}, expected ${upstreamURL}`)
}
if (remote.code !== 0) {
  const added = await run(["remote", "add", "upstream", upstreamURL])
  if (added.code !== 0) fail("Failed to add upstream remote")
}

const fetched = await run(["fetch", "upstream", "--tags", "dev"])
if (fetched.code !== 0) fail("git fetch upstream --tags dev failed")

const mirrorExists = (await check(["show-ref", "--verify", "--quiet", "refs/heads/upstream"])).code === 0
if (!mirrorExists) {
  const created = await run(["branch", "upstream", "upstream/dev"])
  if (created.code !== 0) fail("Failed to create the local upstream mirror")
}
const ancestor = await run(["merge-base", "--is-ancestor", "upstream", "upstream/dev"])
if (ancestor.code !== 0) {
  fail("Local upstream mirror has fork commits or diverged from upstream/dev; fix it manually, never force-update")
}
const oldRef = await check(["rev-parse", "-q", "--verify", "upstream"])
const newRef = await check(["rev-parse", "-q", "--verify", "upstream/dev"])
if (newRef.code !== 0 && !options.dryRun) fail("upstream/dev could not be resolved; the fetch may have failed")
// A dry run may happen before the first fetch, so it plans with a placeholder instead of an unresolved OID.
const newTip = newRef.code === 0 ? newRef.text : "<upstream/dev>"
const oldTip = oldRef.code === 0 ? oldRef.text : newTip
const updated = await run(["update-ref", "refs/heads/upstream", newTip, oldTip])
if (updated.code !== 0) fail("Failed to fast-forward the local upstream mirror")

if (options.pushMirror) {
  const ancestor = await run(["merge-base", "--is-ancestor", "origin/upstream", "upstream"])
  if (ancestor.code !== 0) fail("origin/upstream is not an ancestor of the new mirror tip; refusing to push")
  const pushed = await run(["push", "origin", "upstream:upstream"])
  if (pushed.code !== 0) fail("git push origin upstream:upstream failed")
}

if (!options.continue) {
  const exists = (await check(["show-ref", "--verify", "--quiet", `refs/heads/${syncBranch}`])).code === 0
  if (exists) fail(`Branch ${syncBranch} already exists; delete it or use --continue to finish the in-progress merge`)
  const created = await run(["switch", "-c", syncBranch, "main"])
  if (created.code !== 0) fail(`Failed to create ${syncBranch} from main`)
  const merged = await run(["merge", "--no-ff", "--no-edit", target])
  if (merged.code !== 0) {
    const conflicts = await check(["diff", "--name-only", "--diff-filter=U"])
    console.log(`Conflicted files:\n${conflicts.text || "(none)"}`)
    console.log(
      "Resolve conflicts by keeping upstream structure and re-applying fork features, stage the results, then run: bun script/sync-upstream.ts --continue",
    )
    process.exit(1)
  }
}
if (options.continue) {
  const continued = await run(["merge", "--continue"], { GIT_EDITOR: "true" })
  if (continued.code !== 0) fail("git merge --continue failed; resolve the remaining conflicts and retry --continue")
}

const switched = await run(["switch", "main"])
if (switched.code !== 0) fail("Failed to switch to main")
const mergedMain = await run(["merge", "--no-ff", "--no-edit", syncBranch])
if (mergedMain.code !== 0) fail(`Failed to merge ${syncBranch} into main`)

const tagExample = options.tag ? `${options.tag}-better.N` : "v<base>-better.N"
console.log(`
Checklist:
  - bun install
  - Protocol changed? Run bun run generate from packages/client
  - bun run check
  - Run targeted tests for the changed packages
  - Tag ${tagExample} (e.g. v2.4.2-better.1; N starts at 1)
`)
