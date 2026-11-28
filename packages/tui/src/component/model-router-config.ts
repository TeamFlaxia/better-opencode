import { applyEdits, modify, parse } from "jsonc-parser"
import { rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

export const tiers = ["fast", "medium", "heavy"] as const
export type Tier = (typeof tiers)[number]

export type TierConfig = {
  model: string
  readOnly?: boolean
  costRatio?: number
  description?: string
  whenToUse?: string[]
}

export type Preset = Partial<Record<Tier, TierConfig>>

export type RouterOverrides = {
  activePreset?: string
  presets: Record<string, Preset>
}

export type RouterState = {
  activePreset?: string
}

const formatting = { insertSpaces: true, tabSize: 2, eol: "\n" }

// The router plugin hardcodes this directory. The state file holds runtime
// selections and the overrides file holds the defaults, so edits that should
// survive a plugin update belong in the overrides file.
export function routerPaths(home = homedir()) {
  const dir = path.join(home, ".config", "opencode")
  return {
    dir,
    overrides: path.join(dir, "opencode-model-router.overrides.jsonc"),
    state: path.join(dir, "opencode-model-router.state.json"),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readText(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return undefined
  return handle.text()
}

async function writeText(file: string, text: string) {
  // Rename keeps a reader from seeing a half-written file.
  const temp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`
  await Bun.write(temp, text)
  await rename(temp, file)
}

function normalizeTier(value: unknown): TierConfig | undefined {
  if (!isRecord(value)) return undefined
  return {
    model: typeof value.model === "string" ? value.model : "",
    readOnly: typeof value.readOnly === "boolean" ? value.readOnly : undefined,
    costRatio: typeof value.costRatio === "number" ? value.costRatio : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    whenToUse: Array.isArray(value.whenToUse)
      ? value.whenToUse.filter((item): item is string => typeof item === "string")
      : undefined,
  }
}

function normalizeOverrides(raw: unknown): RouterOverrides {
  if (!isRecord(raw)) return { presets: {} }
  const presets: Record<string, Preset> = {}
  if (isRecord(raw.presets)) {
    for (const [name, value] of Object.entries(raw.presets)) {
      if (!isRecord(value)) continue
      const preset: Preset = {}
      for (const tier of tiers) {
        const config = normalizeTier(value[tier])
        if (config) preset[tier] = config
      }
      presets[name] = preset
    }
  }
  return {
    activePreset: typeof raw.activePreset === "string" ? raw.activePreset : undefined,
    presets,
  }
}

export async function readRouter(home = homedir()) {
  const paths = routerPaths(home)
  const overrides = normalizeOverrides(parse((await readText(paths.overrides)) ?? "{}"))
  const stateRaw = parse((await readText(paths.state)) ?? "{}")
  const state: RouterState =
    isRecord(stateRaw) && typeof stateRaw.activePreset === "string" ? { activePreset: stateRaw.activePreset } : {}
  const project = await Bun.file(
    path.join(process.cwd(), ".opencode", "opencode-model-router.overrides.jsonc"),
  ).exists()
  return { paths, overrides, state, project }
}

function edit(text: string, keys: (string | number)[], value: unknown) {
  return applyEdits(text, modify(text, keys, value, { formattingOptions: formatting }))
}

async function editOverrides(home: string, update: (text: string) => string) {
  const paths = routerPaths(home)
  const text = (await readText(paths.overrides)) ?? "{}\n"
  await writeText(paths.overrides, update(text))
}

export function writeTierField(
  home: string,
  preset: string,
  tier: Tier,
  field: keyof TierConfig,
  value: string | number | boolean | string[] | undefined,
) {
  return editOverrides(home, (text) => edit(text, ["presets", preset, tier, field], value))
}

export function writeTier(home: string, preset: string, tier: Tier, value: TierConfig) {
  return editOverrides(home, (text) => edit(text, ["presets", preset, tier], value))
}

export function writeDefaultPreset(home: string, preset: string | undefined) {
  return editOverrides(home, (text) => edit(text, ["activePreset"], preset))
}

async function writeState(file: string, state: Record<string, unknown>) {
  await writeText(file, JSON.stringify(state, null, 2) + "\n")
}

// The plugin shares this file with its own runtime keys, so only activePreset is ours to change.
export async function writeActivePreset(home: string, preset: string) {
  const file = routerPaths(home).state
  const raw = parse((await readText(file)) ?? "{}")
  await writeState(file, { ...(isRecord(raw) ? raw : {}), activePreset: preset })
}

export async function createPreset(home: string, name: string, source?: string) {
  const paths = routerPaths(home)
  const text = (await readText(paths.overrides)) ?? "{}\n"
  const raw = parse(text)
  const preset = source && isRecord(raw) && isRecord(raw.presets) ? (raw.presets as Record<string, unknown>)[source] : {}
  await writeText(paths.overrides, edit(text, ["presets", name], preset ?? {}))
}

export async function renamePreset(home: string, from: string, to: string) {
  const paths = routerPaths(home)
  const text = (await readText(paths.overrides)) ?? "{}\n"
  const raw = parse(text)
  const presets = isRecord(raw) && isRecord(raw.presets) ? (raw.presets as Record<string, unknown>) : {}
  const preset = presets[from] ?? {}
  let next = edit(text, ["presets", to], preset)
  next = edit(next, ["presets", from], undefined)
  if (isRecord(raw) && raw.activePreset === from) next = edit(next, ["activePreset"], to)
  await writeText(paths.overrides, next)
  const state = parse((await readText(paths.state)) ?? "{}")
  if (isRecord(state) && state.activePreset === from) await writeActivePreset(home, to)
}

export async function removePreset(home: string, name: string) {
  const paths = routerPaths(home)
  const text = (await readText(paths.overrides)) ?? "{}\n"
  const raw = parse(text)
  const remaining = isRecord(raw) && isRecord(raw.presets) ? Object.keys(raw.presets).filter((key) => key !== name) : []
  const fallback = remaining[0]
  let next = edit(text, ["presets", name], undefined)
  if (isRecord(raw) && raw.activePreset === name) next = edit(next, ["activePreset"], fallback)
  await writeText(paths.overrides, next)
  const state = parse((await readText(paths.state)) ?? "{}")
  if (isRecord(state) && state.activePreset === name) {
    if (fallback) await writeActivePreset(home, fallback)
    else {
      const next = { ...state }
      delete next.activePreset
      await writeState(paths.state, next)
    }
  }
}

export function presetNameError(name: string, existing: readonly string[]) {
  const value = name.trim()
  if (!value) return "Preset name is required"
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return "Use letters, numbers, dot, dash or underscore"
  if (existing.includes(value)) return "A preset with this name already exists"
  return undefined
}

export function parseWhenToUse(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function tierSummary(preset: Preset | undefined) {
  if (!preset) return ""
  return tiers
    .map((tier) => `${tier} → ${preset[tier]?.model || "—"}`)
    .join(" · ")
}
