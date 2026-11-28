import path from "path"
import fs from "fs"
import os from "os"
import { Context, Effect, Layer } from "effect"
// XDG on runtimes with a home directory; one tmp-rooted directory on workerd.
// The variants resolve through the `workerd` bundle condition, like the
// native-module stubs, so no runtime sniffing happens here.
import { roots } from "#global-roots"
import { Flock } from "./flock.js"
import { makeGlobalNode } from "./effect/app-node.js"

const app = "opencode"
// Every root, including config, keeps the upstream `opencode` name so existing
// data, cache, state, logs and binaries keep working. The fork's former
// `theiacode` config directory is migrated into it once below.
const { data, cache, config, state, tmp } = roots(app)
const legacyConfig = path.join(path.dirname(config), "theiacode")

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  // The acquired service canonicalizes default tmp; use it instead of Path.tmp for path comparisons.
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Path.config,
    state: Path.state,
    tmp: input.tmp ?? Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const acquire = (input: Partial<Interface>) =>
  Effect.gen(function* () {
    const service = Service.of(make(input))
    yield* Effect.promise(() =>
      Promise.all(
        [service.data, service.config, service.state, service.log, service.bin, service.repos, service.tmp].map(
          (directory) => fs.promises.mkdir(directory, { recursive: true }),
        ),
      ),
    )
    const canonicalTmp = yield* Effect.promise(() => fs.promises.realpath(service.tmp))
    return Service.of({ ...service, tmp: input.tmp ?? canonicalTmp })
  })

/**
 * Seeds the canonical `opencode` config directory from the fork's former
 * `theiacode` one once. Best effort: copy an entry only when the destination is
 * missing or the source file is newer, never overwrite a newer destination,
 * never delete the legacy directory, and never fail startup when it is
 * unreadable. The marker keeps later starts from restoring entries the user
 * removed; skip both marker names so a stale marker is never copied along.
 */
const migrationMarker = path.join(Path.config, ".migrated-from-theiacode")
const migrationMarkers = new Set([".migrated-from-theiacode", ".migrated-from-opencode"])

async function copyNewer(source: string, destination: string) {
  const [sourceStat, destinationStat] = await Promise.all([
    fs.promises.stat(source),
    fs.promises.stat(destination).catch(() => undefined),
  ])
  if (!destinationStat) {
    await fs.promises.cp(source, destination, { recursive: true, force: true, errorOnExist: false })
    return
  }
  if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
    const entries = await fs.promises.readdir(source)
    await Promise.all(
      entries
        .filter((entry) => !migrationMarkers.has(entry))
        .map((entry) => copyNewer(path.join(source, entry), path.join(destination, entry))),
    )
    return
  }
  if (sourceStat.isFile() && destinationStat.isFile() && sourceStat.mtimeMs > destinationStat.mtimeMs) {
    await fs.promises.cp(source, destination, { force: true })
  }
}

const migrateConfig = Effect.promise(async () => {
  if (await Bun.file(migrationMarker).exists()) return
  const entries = await fs.promises.readdir(legacyConfig).catch(() => undefined)
  // No legacy directory (or an empty one): do nothing and write no marker, so a
  // legacy directory created later can still be migrated on a later start.
  if (!entries?.length) return
  await fs.promises.mkdir(Path.config, { recursive: true })
  await Promise.all(
    entries
      .filter((entry) => !migrationMarkers.has(entry))
      .map((entry) => copyNewer(path.join(legacyConfig, entry), path.join(Path.config, entry)).catch(() => undefined)),
  )
  await Bun.write(migrationMarker, "")
})

const acquireWithMigration = (input: Partial<Interface>) =>
  Effect.suspend(() => {
    // An explicit config directory is the user's choice: start fresh there.
    if (input.config !== undefined) return acquire(input)
    const configDir = process.env.OPENCODE_CONFIG_DIR
    if (configDir !== undefined) return acquire({ ...input, config: configDir })
    return Effect.flatMap(migrateConfig, () => acquire(input))
  })

const layer = Layer.effect(Service, acquireWithMigration({}))

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) => Layer.effect(Service, acquireWithMigration(input))

export * as Global from "./global.js"
