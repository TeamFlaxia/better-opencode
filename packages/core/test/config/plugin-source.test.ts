import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigPlugin } from "@opencode/schema/config/plugin"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const defaults = [...ConfigPlugin.defaultPackages]

const operations = (entries: readonly Entry[] = []) =>
  Effect.gen(function* () {
    const source = yield* ConfigPluginSource.Service
    return yield* source.operations()
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ConfigPluginSource.node]), [
        Config.node.replace(Config.testLayer([...entries])),
        Watcher.node.replace(Watcher.testLayer),
        Location.node.replace(tempLocationLayer),
      ]),
    ),
  )

const document = (plugins: NonNullable<Info["plugins"]>) =>
  new Document({ type: "document", info: new Info({ plugins }) })

describe("ConfigPluginSource defaults", () => {
  it.live("installs the default package when config leaves it alone", () =>
    Effect.gen(function* () {
      expect(yield* operations([document(defaults)])).toEqual([
        { type: "add", target: "opencode-model-router@latest", options: {} },
      ])
    }),
  )

  it.live("replaces the default with a pin or bare name instead of installing both", () =>
    Effect.gen(function* () {
      expect(yield* operations([document([...defaults, "opencode-model-router@2.9.1"])])).toEqual([
        { type: "add", target: "opencode-model-router@2.9.1", options: {} },
      ])
      expect(yield* operations([document([...defaults, "opencode-model-router"])])).toEqual([
        { type: "add", target: "opencode-model-router", options: {} },
      ])
    }),
  )

  it.live("does not install the default when config disables or removes every plugin", () =>
    Effect.gen(function* () {
      expect(yield* operations([document([...defaults, "-opencode-model-router"])])).toEqual([
        { type: "remove", target: "opencode-model-router" },
      ])
      expect(yield* operations([document([...defaults, "-*"])])).toEqual([{ type: "remove", target: "*" }])
    }),
  )

  it.live("lets a later add re-enable a package removed earlier", () =>
    Effect.gen(function* () {
      expect(
        yield* operations([document([...defaults, "-opencode-model-router", "opencode-model-router@2.9.1"])]),
      ).toEqual([
        { type: "remove", target: "opencode-model-router" },
        { type: "add", target: "opencode-model-router@2.9.1", options: {} },
      ])
    }),
  )
})
