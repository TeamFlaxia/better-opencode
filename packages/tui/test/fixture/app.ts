import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import path from "node:path"
import { Global } from "@opencode/util/global"
import type { TuiInput } from "../../src/app"
import type { Config } from "../../src/config"
import { tmpdir } from "./fixture"
import { createEventStream, createFetch, type FetchHandler } from "./tui-client"

export async function createAppFixture(
  input: {
    width?: number
    height?: number
    state?: string
    config?: Config.Info
    args?: TuiInput["args"]
    fetch?: FetchHandler
    // A renderer whose owner already set up its terminal, such as the simulation renderer.
    setup?: TestRendererSetup
  } = {},
) {
  const { run } = await import("../../src/app")
  const root = await tmpdir()
  const setup =
    input.setup ??
    (await createTestRenderer({
      width: input.width ?? 100,
      height: input.height ?? 30,
      kittyKeyboard: true,
    }))
  if (!input.setup) await setup.renderer.setupTerminal()
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const events = createEventStream()
  const calls = createFetch(input.fetch, events)
  // Updates apply to a copy, as a config file would, so preference writes persist for the rest of the test.
  const provided = input.config
  let config: Config.Info = structuredClone({
    language: "en",
    ...(provided ?? { animations: false }),
    // Keep app fixtures on the pre-fork defaults even though the product defaults now
    // mirror the maintainer's current configuration.
    theme: { mode: "system", name: "opencode", ...provided?.theme },
    session: { sidebar: "auto", scrollbar: false, ...provided?.session },
    tabs: { mode: "auto", layout: "horizontal", ...provided?.tabs },
    experimental: {
      "vcs-dock": false,
      "task-graph": false,
      "file-manager": false,
      "client-mcp": false,
      "new-designs": false,
      ...provided?.experimental,
    },
  })
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => config,
        update: async (mutate) => {
          const next = structuredClone(config)
          mutate(next)
          config = next
          return next
        },
      },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
      args: input.args ?? {},
      log: () => {},
    }).pipe(
      Effect.provide(
        Global.layerWith({
          home: path.join(root.path, "home"),
          data: path.join(root.path, "data"),
          cache: path.join(root.path, "cache"),
          config: path.join(root.path, "config"),
          state: input.state ?? path.join(root.path, "state"),
          bin: path.join(root.path, "cache", "bin"),
          log: path.join(root.path, "data", "log"),
          repos: path.join(root.path, "data", "repos"),
          tmp: path.join(root.path, "tmp"),
        }),
      ),
      Effect.provide(FileSystem.layerNoop({})),
    ),
  )
  return {
    ...setup,
    events,
    config: () => config,
    ready: ready.promise,
    async [Symbol.asyncDispose]() {
      try {
        if (!setup.renderer.isDestroyed) setup.renderer.destroy()
        await task
      } finally {
        await server.stop()
        await root[Symbol.asyncDispose]()
      }
    },
  }
}
