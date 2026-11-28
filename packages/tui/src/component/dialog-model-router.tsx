import { createMemo, createSignal, Match, Switch } from "solid-js"
import { homedir } from "node:os"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { errorMessage } from "../util/error"
import { DIALOG_LIST_INSET, useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import {
  createPreset,
  parseWhenToUse,
  presetNameError,
  readRouter,
  removePreset,
  renamePreset,
  routerPaths,
  tiers,
  tierSummary,
  writeActivePreset,
  writeDefaultPreset,
  writeTierField,
  type RouterOverrides,
  type RouterState,
  type Tier,
  type TierConfig,
} from "./model-router-config"

export type RouterView =
  | { kind: "list" }
  | { kind: "preset"; preset: string }
  | { kind: "tier"; preset: string; tier: Tier }
  | { kind: "model"; preset: string; tier: Tier }

type ListValue = { kind: "preset"; name: string } | { kind: "new" }
type PresetValue =
  | { kind: "activate" }
  | { kind: "default" }
  | { kind: "tier"; tier: Tier }
  | { kind: "rename" }
  | { kind: "duplicate" }
  | { kind: "delete" }
type TierField = keyof TierConfig

const tierFields: { field: TierField; title: string }[] = [
  { field: "model", title: "Model" },
  { field: "readOnly", title: "Read only" },
  { field: "costRatio", title: "Cost ratio" },
  { field: "description", title: "Description" },
  { field: "whenToUse", title: "When to use" },
]

export function DialogModelRouter(props: { view?: RouterView }) {
  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme()
  const client = useClient()
  const route = useRoute()
  const [overrides, setOverrides] = createSignal<RouterOverrides>({ presets: {} })
  const [state, setState] = createSignal<RouterState>({})
  const [project, setProject] = createSignal(false)
  const [ready, setReady] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string>()

  const home = () => homedir()
  const active = () => state().activePreset ?? overrides().activePreset
  const view = () => props.view ?? { kind: "list" as const }

  async function load() {
    try {
      const next = await readRouter()
      setOverrides(next.overrides)
      setState(next.state)
      setProject(next.project)
      setLoadError(undefined)
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setReady(true)
    }
  }
  void load()

  function open(next: RouterView) {
    dialog.replace(() => <DialogModelRouter view={next} />)
  }

  async function apply(work: Promise<void> | void, message: string) {
    try {
      await work
      toast.show({ message, variant: "success" })
      await load()
      return true
    } catch (error) {
      toast.error(error)
      return false
    }
  }

  async function activate(name: string) {
    await writeActivePreset(home(), name)
    // The plugin applies a preset only when this command invalidates its config cache.
    const current = route.data
    if (current.type !== "session") return
    await client.api.session.command({
      sessionID: current.sessionID,
      name: "router-reload",
      text: "",
    })
  }

  function prompt(input: {
    title: string
    placeholder?: string
    value?: string
    back: RouterView
    confirm: (value: string) => void
  }) {
    dialog.replace(() => (
      <DialogPrompt
        title={input.title}
        placeholder={input.placeholder}
        value={input.value}
        onConfirm={input.confirm}
        onCancel={() => open(input.back)}
      />
    ))
  }

  function promptNew(source: string | undefined, back: RouterView) {
    const existing = Object.keys(overrides().presets)
    prompt({
      title: "New preset",
      placeholder: "Preset name",
      back,
      confirm: (value) => {
        const name = value.trim()
        const error = presetNameError(name, existing)
        if (error) {
          toast.show({ message: error, variant: "error" })
          return
        }
        void apply(createPreset(home(), name, source), `Created preset ${name}`).then(
          (ok) => ok && open({ kind: "preset", preset: name }),
        )
      },
    })
  }

  function promptRename(preset: string, back: RouterView) {
    const existing = Object.keys(overrides().presets).filter((name) => name !== preset)
    prompt({
      title: "Rename preset",
      placeholder: "Preset name",
      value: preset,
      back,
      confirm: (value) => {
        const name = value.trim()
        if (name === preset) return
        const error = presetNameError(name, existing)
        if (error) {
          toast.show({ message: error, variant: "error" })
          return
        }
        void apply(renamePreset(home(), preset, name), `Renamed preset to ${name}`).then(
          (ok) => ok && open({ kind: "preset", preset: name }),
        )
      },
    })
  }

  function confirmDelete(preset: string, back: RouterView) {
    dialog.replace(() => (
      <DialogConfirm
        title="Delete preset"
        message={`Delete preset ${preset}?`}
        onConfirm={() =>
          void apply(removePreset(home(), preset), `Deleted preset ${preset}`).then(() => open({ kind: "list" }))
        }
        onCancel={() => open(back)}
      />
    ))
  }

  // A deleted preset or an older dialog can outlive its target.
  const resolved = createMemo<RouterView>(() => {
    const current = view()
    if (current.kind === "list") return current
    return overrides().presets[current.preset] ? current : { kind: "list" }
  })

  const list = () => (
    <DialogSelect<ListValue>
      title="Model router"
      description={project() ? "A project override may take precedence" : undefined}
      current={active() ? { kind: "preset" as const, name: active()! } : undefined}
      options={[
        ...Object.entries(overrides().presets)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, preset]) => ({
            title: `Preset: ${name}`,
            value: { kind: "preset" as const, name },
            searchText: name,
            description: tierSummary(preset),
            footer: name === active() ? "active" : name === overrides().activePreset ? "default" : undefined,
          })),
        {
          title: "New preset",
          value: { kind: "new" as const },
          description: "Duplicate the selected preset",
          footer: "",
        },
      ]}
      renderFilter={Object.keys(overrides().presets).length > 0}
      onCancel={() => dialog.clear()}
      onSelect={(option) => {
        if (option.value.kind === "new") {
          promptNew(active() ?? Object.keys(overrides().presets)[0], { kind: "list" })
          return
        }
        open({ kind: "preset", preset: option.value.name })
      }}
      emptyView={
        <box flexDirection="column" paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET}>
          <text fg={theme.text.muted}>
            {loadError() ? `Failed to read the model router config: ${loadError()}` : ready() ? "No presets yet." : "Reading configuration…"}
          </text>
          <text fg={theme.text.muted}>Expected {routerPaths().overrides}</text>
        </box>
      }
    />
  )

  const preset = () => {
    const current = resolved()
    return "preset" in current ? current.preset : ""
  }
  const presetConfig = () => overrides().presets[preset()]
  const presetCount = () => Object.keys(overrides().presets).length

  const detail = () => (
    <DialogSelect<PresetValue>
      title={`Preset: ${preset()}`}
      description={tierSummary(presetConfig())}
      options={[
        {
          title: "Use as active preset",
          value: { kind: "activate" },
          footer: preset() === active() ? "active" : undefined,
        },
        {
          title: "Set as default preset",
          value: { kind: "default" },
          footer: preset() === overrides().activePreset ? "default" : undefined,
        },
        ...tiers.map((tier) => ({
          title: Locale.titlecase(tier),
          value: { kind: "tier" as const, tier },
          footer: presetConfig()?.[tier]?.model || "not set",
          description: presetConfig()?.[tier]?.description,
        })),
        { title: "Rename preset", value: { kind: "rename" } },
        { title: "Duplicate preset", value: { kind: "duplicate" } },
        { title: "Delete preset", value: { kind: "delete" }, disabled: presetCount() <= 1 },
      ]}
      renderFilter={false}
      onCancel={() => open({ kind: "list" })}
      onSelect={(option) => {
        const value = option.value
        if (value.kind === "activate") {
          void apply(activate(preset()), `Active preset set to ${preset()}`)
          return
        }
        if (value.kind === "default") {
          void apply(writeDefaultPreset(home(), preset()), `Default preset set to ${preset()}`)
          return
        }
        if (value.kind === "tier") {
          open({ kind: "tier", preset: preset(), tier: value.tier })
          return
        }
        if (value.kind === "rename") {
          promptRename(preset(), resolved())
          return
        }
        if (value.kind === "duplicate") {
          promptNew(preset(), resolved())
          return
        }
        confirmDelete(preset(), resolved())
      }}
    />
  )

  const tier = () => (resolved().kind === "tier" ? (resolved() as { preset: string; tier: Tier }) : undefined)
  const tierConfig = () => {
    const current = tier()
    return current ? presetConfig()?.[current.tier] : undefined
  }

  const fieldValue = (field: TierField) => {
    const config = tierConfig()
    if (!config) return "not set"
    const value = config[field]
    if (field === "readOnly") return value ? "on" : "off"
    if (field === "whenToUse") return Array.isArray(value) && value.length > 0 ? value.join(", ") : "not set"
    if (value === undefined || value === "") return "not set"
    return String(value)
  }

  const tierView = () => (
    <DialogSelect<TierField>
      title={`${preset()} · ${Locale.titlecase(tier()!.tier)}`}
      options={tierFields.map((item) => ({
        title: item.title,
        value: item.field,
        footer: fieldValue(item.field),
      }))}
      renderFilter={false}
      onCancel={() => open({ kind: "preset", preset: preset() })}
      onSelect={(option) => {
        const current = tier()!
        if (option.value === "model") {
          open({ kind: "model", preset: current.preset, tier: current.tier })
          return
        }
        if (option.value === "readOnly") {
          void apply(
            writeTierField(home(), current.preset, current.tier, "readOnly", !tierConfig()?.readOnly),
            "Updated readOnly",
          )
          return
        }
        const back: RouterView = { kind: "tier", preset: current.preset, tier: current.tier }
        if (option.value === "costRatio") {
          prompt({
            title: "Cost ratio",
            placeholder: "0",
            value: tierConfig()?.costRatio?.toString(),
            back,
            confirm: (value) => {
              const next = value.trim() === "" ? undefined : Number(value)
              if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
                toast.show({ message: "Cost ratio must be a number of 0 or more", variant: "error" })
                return
              }
              void apply(writeTierField(home(), current.preset, current.tier, "costRatio", next), "Updated cost ratio").then(
                (ok) => ok && open(back),
              )
            },
          })
          return
        }
        if (option.value === "description") {
          prompt({
            title: "Description",
            placeholder: "What this tier is for",
            value: tierConfig()?.description,
            back,
            confirm: (value) => {
              const next = value.trim() === "" ? undefined : value.trim()
              void apply(
                writeTierField(home(), current.preset, current.tier, "description", next),
                "Updated description",
              ).then((ok) => ok && open(back))
            },
          })
          return
        }
        prompt({
          title: "When to use",
          placeholder: "Comma-separated",
          value: tierConfig()?.whenToUse?.join(", "),
          back,
          confirm: (value) => {
            void apply(
              writeTierField(home(), current.preset, current.tier, "whenToUse", parseWhenToUse(value)),
              "Updated when to use",
            ).then((ok) => ok && open(back))
          },
        })
      }}
    />
  )

  const model = () => (resolved().kind === "model" ? (resolved() as { preset: string; tier: Tier }) : undefined)

  const modelView = () => {
    const current = model()!
    return <DialogModelRouterModel preset={current.preset} tier={current.tier} />
  }

  return (
    <Switch>
      <Match when={resolved().kind === "list"}>{list()}</Match>
      <Match when={resolved().kind === "preset"}>{detail()}</Match>
      <Match when={resolved().kind === "tier"}>{tierView()}</Match>
      <Match when={resolved().kind === "model"}>{modelView()}</Match>
    </Switch>
  )
}

function DialogModelRouterModel(props: { preset: string; tier: Tier }) {
  const dialog = useDialog()
  const data = useData()
  const location = useLocation()
  const toast = useToast()
  const overrides = createMemo(() => data.location.model.list(location.ref) ?? [])
  const back: RouterView = { kind: "tier", preset: props.preset, tier: props.tier }

  async function write(value: string) {
    try {
      await writeTierField(homedir(), props.preset, props.tier, "model", value)
      toast.show({ message: "Updated model", variant: "success" })
      dialog.replace(() => <DialogModelRouter view={back} />)
    } catch (error) {
      toast.error(error)
    }
  }

  return (
    <DialogSelect<string>
      title={`Model for ${props.tier}`}
      searchInTitle
      titlePlaceholder="Search models"
      options={[
        { title: "Custom model…", value: "__custom", description: "Type provider/model" },
        ...overrides()
          .filter((model) => model.status !== "deprecated")
          .map((model) => ({
            title: model.name,
            value: `${model.providerID}/${model.id}`,
            description: model.providerID,
            category: model.providerID,
            searchText: `${model.providerID}/${model.id}`,
          })),
      ]}
      onCancel={() => dialog.replace(() => <DialogModelRouter view={back} />)}
      onSelect={(option) => {
        if (option.value !== "__custom") {
          void write(option.value)
          return
        }
        dialog.replace(() => (
          <DialogPrompt
            title="Custom model"
            placeholder="provider/model"
            onConfirm={(value) => {
              const next = value.trim()
              if (!next) return
              void write(next)
            }}
            onCancel={() => dialog.replace(() => <DialogModelRouter view={back} />)}
          />
        ))
      }}
    />
  )
}
