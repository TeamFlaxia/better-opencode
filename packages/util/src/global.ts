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
// The config directory is rebranded to `theiacode`; every other root keeps the
// upstream `opencode` name so existing data, cache, state, logs and binaries
// keep working.
const { data, cache, config, state, tmp } = roots(app, "theiacode")
const legacyConfig = path.join(path.dirname(config), app)

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
 * Seeds the rebranded config directory from the legacy `opencode` one once.
 * Best effort: never overwrites existing files, never deletes the legacy
 * directory, and never fails startup when the legacy directory is unreadable.
 * The marker keeps later starts from restoring entries the user removed.
 */
const migrationMarker = path.join(Path.config, ".migrated-from-opencode")

const migrateConfig = Effect.promise(async () => {
  if (await Bun.file(migrationMarker).exists()) return
  const entries = await fs.promises.readdir(legacyConfig).catch(() => undefined)
  if (!entries?.length) return
  // The config directory can already hold service or CLI state written during
  // startup, so copy only the entries that are still missing.
  await fs.promises.mkdir(Path.config, { recursive: true })
  await Promise.all(
    entries.map((entry) =>
      fs.promises
        .cp(path.join(legacyConfig, entry), path.join(Path.config, entry), {
          recursive: true,
          force: false,
          errorOnExist: false,
        })
        .catch(() => undefined),
    ),
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
