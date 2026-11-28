import { homedir } from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { createMemo, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useI18n } from "../i18n"
import { DIALOG_LIST_INSET } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

// The router plugin hardcodes its global config directory and keeps the
// runtime selection in a separate state file that wins over the overrides
// default, so this dialog only ever writes that state file.
const routerDir = path.join(homedir(), ".config", "opencode")
const overridesFile = path.join(routerDir, "opencode-model-router.overrides.jsonc")
const stateFile = path.join(routerDir, "opencode-model-router.state.json")
const tiers = ["fast", "medium", "heavy"] as const

type Preset = {
  name: string
  models: (string | undefined)[]
}
type Overrides = {
  activePreset?: string
  presets: Preset[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJSONC(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return undefined
  return parse(await handle.text())
}

function normalize(overrides: unknown): Overrides | undefined {
  if (!isRecord(overrides) || !isRecord(overrides.presets)) return undefined
  return {
    activePreset: typeof overrides.activePreset === "string" ? overrides.activePreset : undefined,
    presets: Object.entries(overrides.presets).flatMap(([name, preset]) => {
      if (!isRecord(preset)) return []
      return [
        {
          name,
          models: tiers.map((tier) => {
            const value = preset[tier]
            return isRecord(value) && typeof value.model === "string" ? value.model : undefined
          }),
        },
      ]
    }),
  }
}

export function DialogModelRouter() {
  const theme = useTheme()
  const toast = useToast()
  const { t } = useI18n()
  const [overrides, setOverrides] = createSignal<Overrides>()
  const [active, setActive] = createSignal<string>()
  const [loaded, setLoaded] = createSignal(false)
  const [saving, setSaving] = createSignal(false)

  void load()

  async function load() {
    const next = normalize(await readJSONC(overridesFile))
    setOverrides(next)
    if (next) {
      const state = await readJSONC(stateFile)
      const selected = isRecord(state) && typeof state.activePreset === "string" ? state.activePreset : undefined
      setActive(selected ?? next.activePreset)
    }
    setLoaded(true)
  }

  const options = createMemo(() =>
    (overrides()?.presets ?? []).map((preset) => ({
      title: t("Preset: {{name}}", { name: preset.name }),
      value: preset.name,
      searchText: preset.name,
      description: preset.models.map((model, index) => `${tiers[index]} → ${model ?? "—"}`).join(" · "),
      footer: preset.name === active() ? t("active") : t("default"),
    })),
  )

  async function select(name: string) {
    if (saving()) return
    setSaving(true)
    await Bun.write(stateFile, JSON.stringify({ activePreset: name }, null, 2) + "\n")
      .then(() => {
        setActive(name)
        toast.show({
          title: t("Model router"),
          message: t("Active preset set to {{name}}", { name }),
          variant: "success",
        })
      })
      .catch(toast.error)
      .finally(() => setSaving(false))
  }

  return (
    <DialogSelect
      title={t("Model router")}
      options={options()}
      current={active()}
      renderFilter={options().length > 0}
      onSelect={(option) => void select(option.value)}
      emptyView={
        <box flexDirection="column" paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
          <text fg={theme.text.muted}>
            {loaded() ? t("No model router presets found.") : t("Reading configuration…")}
          </text>
          <text fg={theme.text.muted}>{t("Expected {{path}}", { path: overridesFile })}</text>
          <text fg={theme.text.muted}>{t("Expected {{path}}", { path: stateFile })}</text>
          <text fg={theme.text.muted}>{t("Run /preset to create one with the router plugin.")}</text>
        </box>
      }
    />
  )
}
