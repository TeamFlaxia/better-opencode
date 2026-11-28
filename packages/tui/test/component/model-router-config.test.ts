import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  createPreset,
  parseWhenToUse,
  presetNameError,
  readRouter,
  removePreset,
  renamePreset,
  routerPaths,
  writeActivePreset,
  writeDefaultPreset,
  writeTierField,
} from "../../src/component/model-router-config"

const homes: string[] = []

async function home() {
  const dir = await mkdtemp(path.join(tmpdir(), "model-router-"))
  homes.push(dir)
  return dir
}

async function seed(dir: string, overrides: string, state?: Record<string, unknown>) {
  const paths = routerPaths(dir)
  await Bun.write(paths.overrides, overrides)
  if (state) await Bun.write(paths.state, JSON.stringify(state, null, 2) + "\n")
  return paths
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("model router config", () => {
  test("reads presets and keeps comments when editing a tier field", async () => {
    const dir = await home()
    const paths = await seed(
      dir,
      `{
  // keep this comment
  "activePreset": "alpha",
  "presets": {
    "alpha": {
      "fast": { "model": "provider/alpha", "readOnly": true }
    }
  }
}
`,
      { activePreset: "alpha" },
    )

    const read = await readRouter(dir)
    expect(read.overrides.activePreset).toBe("alpha")
    expect(read.overrides.presets.alpha?.fast?.model).toBe("provider/alpha")
    expect(read.state.activePreset).toBe("alpha")

    await writeTierField(dir, "alpha", "fast", "model", "provider/next")
    const text = await Bun.file(paths.overrides).text()
    expect(text).toContain("// keep this comment")
    expect(text).toContain('"provider/next"')

    const next = await readRouter(dir)
    expect(next.overrides.presets.alpha?.fast?.model).toBe("provider/next")
    expect(next.overrides.presets.alpha?.fast?.readOnly).toBe(true)
  })

  test("writes optional tier fields and removes them when cleared", async () => {
    const dir = await home()
    const paths = await seed(dir, `{ "presets": { "alpha": { "fast": { "model": "p/a" } } } }`)
    await writeTierField(dir, "alpha", "fast", "costRatio", 2)
    await writeTierField(dir, "alpha", "fast", "whenToUse", ["search", "read"])
    await writeTierField(dir, "alpha", "fast", "description", "fast work")

    let read = await readRouter(dir)
    expect(read.overrides.presets.alpha?.fast?.model).toBe("p/a")
    expect(read.overrides.presets.alpha?.fast?.costRatio).toBe(2)
    expect(read.overrides.presets.alpha?.fast?.description).toBe("fast work")
    expect(read.overrides.presets.alpha?.fast?.whenToUse).toEqual(["search", "read"])

    await writeTierField(dir, "alpha", "fast", "costRatio", undefined)
    read = await readRouter(dir)
    expect(read.overrides.presets.alpha?.fast?.costRatio).toBeUndefined()
    expect(await Bun.file(paths.overrides).text()).not.toContain("costRatio")
  })

  test("switches the default and active preset", async () => {
    const dir = await home()
    const paths = await seed(dir, `{ "presets": { "alpha": {}, "beta": {} } }`, { activePreset: "alpha" })
    await writeDefaultPreset(dir, "beta")
    await writeActivePreset(dir, "beta")

    const read = await readRouter(dir)
    expect(read.overrides.activePreset).toBe("beta")
    expect(JSON.parse(await Bun.file(paths.state).text())).toEqual({ activePreset: "beta" })
  })

  test("merges the active preset into state owned by the plugin", async () => {
    const dir = await home()
    const paths = await seed(dir, `{ "presets": { "alpha": {}, "beta": {} } }`, {
      activePreset: "alpha",
      activeMode: "mode-x",
      enforcementMode: "enforce",
    })

    await writeActivePreset(dir, "beta")
    expect(JSON.parse(await Bun.file(paths.state).text())).toEqual({
      activePreset: "beta",
      activeMode: "mode-x",
      enforcementMode: "enforce",
    })
  })

  test("creates, renames, and removes presets", async () => {
    const dir = await home()
    await seed(
      dir,
      `{ "activePreset": "alpha", "presets": { "alpha": { "fast": { "model": "p/a" } }, "beta": {} } }`,
      { activePreset: "alpha" },
    )

    await createPreset(dir, "gamma", "alpha")
    let read = await readRouter(dir)
    expect(read.overrides.presets.gamma?.fast?.model).toBe("p/a")

    await renamePreset(dir, "alpha", "omega")
    read = await readRouter(dir)
    expect(read.overrides.presets.alpha).toBeUndefined()
    expect(read.overrides.presets.omega?.fast?.model).toBe("p/a")
    expect(read.overrides.activePreset).toBe("omega")
    expect(read.state.activePreset).toBe("omega")

    await removePreset(dir, "omega")
    read = await readRouter(dir)
    expect(read.overrides.presets.omega).toBeUndefined()
    expect(read.overrides.activePreset).toBe("beta")
    expect(read.state.activePreset).toBe("beta")
  })

  test("removing the last active preset keeps other state keys", async () => {
    const dir = await home()
    const paths = await seed(dir, `{ "presets": { "alpha": {} } }`, {
      activePreset: "alpha",
      activeMode: "mode-x",
      enforcementMode: "enforce",
    })

    await removePreset(dir, "alpha")
    expect(JSON.parse(await Bun.file(paths.state).text())).toEqual({
      activeMode: "mode-x",
      enforcementMode: "enforce",
    })
  })

  test("validates preset names and parses whenToUse", () => {
    expect(presetNameError("", [])).toBeTruthy()
    expect(presetNameError("has space", [])).toBeTruthy()
    expect(presetNameError("beta", ["alpha", "beta"])).toBeTruthy()
    expect(presetNameError("beta", ["alpha"])).toBeUndefined()
    expect(parseWhenToUse(" search, read\nreview ,, ")).toEqual(["search", "read", "review"])
  })
})
