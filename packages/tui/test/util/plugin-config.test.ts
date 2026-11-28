import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pluginEnabled, pluginName, readPluginEnabled, setPluginEnabled } from "../../src/util/plugin-config"

const homes: string[] = []

async function home() {
  const dir = await mkdtemp(path.join(tmpdir(), "plugin-config-"))
  homes.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("plugin config", () => {
  test("reads plugin enablement in order", () => {
    expect(pluginEnabled(undefined, "opencode-model-router")).toBe(false)
    expect(pluginEnabled(["opencode-model-router"], "opencode-model-router")).toBe(true)
    expect(pluginEnabled(["opencode-model-router@2.10.0"], "opencode-model-router")).toBe(true)
    expect(pluginEnabled(["opencode-model-router", "-opencode-model-router"], "opencode-model-router")).toBe(false)
    expect(pluginEnabled(["-opencode-model-router", "opencode-model-router"], "opencode-model-router")).toBe(true)
    expect(
      pluginEnabled([{ package: "opencode-model-router", options: { enabled: false } }], "opencode-model-router"),
    ).toBe(false)
  })

  test("extracts the package name from specs", () => {
    expect(pluginName("opencode-model-router")).toBe("opencode-model-router")
    expect(pluginName("opencode-model-router@2.10.0")).toBe("opencode-model-router")
    expect(pluginName("-opencode-model-router")).toBe("opencode-model-router")
    expect(pluginName("@scope/plugin@1.0.0")).toBe("@scope/plugin")
    expect(pluginName("@scope/plugin")).toBe("@scope/plugin")
  })

  test("enables and disables a package in the global server config", async () => {
    const dir = await home()
    const file = path.join(dir, ".config", "opencode", "opencode.jsonc")
    await Bun.write(
      file,
      `{
  // server config
  "plugins": ["other-plugin"],
  "experimental": { "task-graph": true }
}
`,
    )

    expect(await readPluginEnabled("opencode-model-router", dir)).toBe(false)
    await setPluginEnabled("opencode-model-router", true, dir)
    let text = await Bun.file(file).text()
    expect(text).toContain("// server config")
    expect(text).toContain('"opencode-model-router"')
    expect(text).toContain('"other-plugin"')
    expect(await readPluginEnabled("opencode-model-router", dir)).toBe(true)

    await setPluginEnabled("opencode-model-router", false, dir)
    expect(await readPluginEnabled("opencode-model-router", dir)).toBe(false)
    text = await Bun.file(file).text()
    expect(text).toContain('"-opencode-model-router"')

    await setPluginEnabled("opencode-model-router", true, dir)
    text = await Bun.file(file).text()
    expect(text.match(/"opencode-model-router"/g)?.length).toBe(1)
    expect(text).not.toContain('"-opencode-model-router"')
  })
})
