import { applyEdits, modify, parse } from "jsonc-parser"
import { rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

const formatting = { insertSpaces: true, tabSize: 2, eol: "\n" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readText(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return undefined
  return handle.text()
}

async function writeText(file: string, text: string) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`
  await Bun.write(temp, text)
  await rename(temp, file)
}

export function pluginName(spec: string) {
  const value = spec.startsWith("-") ? spec.slice(1) : spec
  const at = value.lastIndexOf("@")
  return at > 0 ? value.slice(0, at) : value
}

// The server reads plugins from the global config. Keep this list in sync with
// `resolveConfigPath` in the plugin add handler.
async function resolveConfigFile(home: string) {
  const dir = path.join(home, ".config", "theiacode")
  const candidates = [
    path.join(dir, "opencode.json"),
    path.join(dir, "opencode.jsonc"),
    path.join(dir, ".opencode", "opencode.json"),
    path.join(dir, ".opencode", "opencode.jsonc"),
  ]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return candidates[0]!
}

function pluginSpec(entry: unknown) {
  if (typeof entry === "string") return entry
  if (isRecord(entry) && typeof entry.package === "string") return entry.package
  return undefined
}

export function pluginEnabled(plugins: unknown, name: string) {
  if (!Array.isArray(plugins)) return false
  let enabled = false
  for (const entry of plugins) {
    const spec = pluginSpec(entry)
    if (!spec) continue
    if (spec === "-*") {
      enabled = false
      continue
    }
    if (pluginName(spec) !== name) continue
    if (spec.startsWith("-")) {
      enabled = false
      continue
    }
    enabled = isRecord(entry) ? (entry.options as Record<string, unknown> | undefined)?.enabled !== false : true
  }
  return enabled
}

export async function readPluginEnabled(name: string, home = homedir()) {
  const text = (await readText(await resolveConfigFile(home))) ?? "{}"
  const raw = parse(text)
  return pluginEnabled(isRecord(raw) ? raw.plugins : undefined, name)
}

export async function setPluginEnabled(name: string, enabled: boolean, home = homedir()) {
  const file = await resolveConfigFile(home)
  const text = (await readText(file)) ?? "{}\n"
  const raw = parse(text)
  const plugins = isRecord(raw) && Array.isArray(raw.plugins) ? raw.plugins : []
  // Drop every earlier directive for this package so the new one is the last
  // word, then leave unrelated plugin entries untouched.
  const next = [
    ...plugins.filter((entry) => pluginName(pluginSpec(entry) ?? "") !== name),
    enabled ? name : `-${name}`,
  ]
  await writeText(file, applyEdits(text, modify(text, ["plugins"], next, { formattingOptions: formatting })))
}
