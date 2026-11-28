export * as ConfigPlugin from "./plugin.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Entry extends Schema.Class<Entry>("Config.Plugin.Entry")({
  package: Schema.String,
  options: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
}) {}

export const Plugin = Schema.Union([Schema.String, Entry])
export type Plugin = typeof Plugin.Type

export const Plugins = Plugin.pipe(Schema.Array)

/**
 * Packages theia-code's CLI server installs when no config mentions them.
 *
 * They stay ordinary external packages: the repository and release artifacts do
 * not bundle their code. npm installs them from their publisher, and `@latest`
 * makes the plugin supervisor follow and update them automatically.
 *
 * The default package is installed and kept current but carries `enabled: false`,
 * so it is not activated unless the user adds it to `plugins` themselves.
 */
export const defaultPackages = [
  new Entry({ package: "opencode-model-router@latest", options: { enabled: false } }),
] as const
