import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { Context, Effect, Layer } from "effect"
import { Global } from "../src/global.js"

describe("global", () => {
  test("importing the module does not create directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-import-"))
    const directories = ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
    const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
    const result = Bun.spawnSync({
      cmd: [process.execPath, "-e", `const { Global } = await import(${JSON.stringify(module)}); void Global.Path.tmp`],
      env: {
        ...process.env,
        XDG_DATA_HOME: directories[0],
        XDG_CACHE_HOME: directories[1],
        XDG_CONFIG_HOME: directories[2],
        XDG_STATE_HOME: directories[3],
        // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
        TMPDIR: directories[4],
        TEMP: directories[4],
      },
      stderr: "pipe",
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const created = ["opencode", "opencode", "opencode", "opencode", "opencode"]
    directories.forEach((directory, index) =>
      expect(fs.existsSync(path.join(directory, created[index]))).toBe(false),
    )
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("building layerWith creates service directories and preserves an explicit tmp", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const directories = {
      data: path.join(root, "data"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      log: path.join(root, "log"),
      bin: path.join(root, "bin"),
      repos: path.join(root, "repos"),
      tmp: path.join(root, "nested", "..", "tmp"),
    }

    const context = await Effect.runPromise(Effect.scoped(Layer.build(Global.layerWith(directories))))

    Object.values(directories).forEach((directory) => expect(fs.statSync(directory).isDirectory()).toBe(true))
    expect(Context.get(context, Global.Service).tmp).toBe(directories.tmp)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("building a layer with default tmp creates and canonicalizes it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-layer-"))
    const result = acquire(root)

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const tmp = path.join(root, "tmp")
    // The layer canonicalizes through the native realpath, which on Windows also expands 8.3 short
    // names such as RUNNER~1 that the JavaScript realpathSync leaves in place.
    expect(result.stdout.toString()).toBe(fs.realpathSync.native(path.join(tmp, "opencode")))
    const created = [
      path.join(root, "data", "opencode"),
      path.join(root, "cache", "opencode", "bin"),
      path.join(root, "config", "opencode"),
      path.join(root, "state", "opencode"),
      path.join(root, "data", "opencode", "log"),
      path.join(root, "data", "opencode", "repos"),
      path.join(tmp, "opencode"),
    ]
    created.forEach((directory) => expect(fs.statSync(directory).isDirectory()).toBe(true))
    fs.rmSync(root, { recursive: true, force: true })
  })
})

describe("global config migration", () => {
  test("seeds a missing opencode directory from the legacy theiacode directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))
    const legacy = path.join(root, "config", "theiacode")
    fs.mkdirSync(path.join(legacy, "project"), { recursive: true })
    fs.writeFileSync(path.join(legacy, "opencode.json"), '{"legacy":true}')
    fs.writeFileSync(path.join(legacy, "project", "project.json"), '{"legacy":true}')
    fs.writeFileSync(path.join(legacy, ".migrated-from-opencode"), "")

    const result = acquire(root)

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const migrated = path.join(root, "config", "opencode")
    expect(fs.readFileSync(path.join(migrated, "opencode.json"), "utf8")).toBe('{"legacy":true}')
    expect(fs.readFileSync(path.join(migrated, "project", "project.json"), "utf8")).toBe('{"legacy":true}')
    // The legacy directory stays in place after the copy.
    expect(fs.readFileSync(path.join(legacy, "opencode.json"), "utf8")).toBe('{"legacy":true}')
    // Markers are never copied; only the new marker is written at the destination.
    expect(fs.existsSync(path.join(migrated, ".migrated-from-opencode"))).toBe(false)
    expect(fs.existsSync(path.join(migrated, ".migrated-from-theiacode"))).toBe(true)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("fills missing entries, copies newer source files, and keeps newer destinations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))
    const legacy = path.join(root, "config", "theiacode")
    const current = path.join(root, "config", "opencode")
    fs.mkdirSync(path.join(legacy, "project"), { recursive: true })
    fs.mkdirSync(path.join(current, "project"), { recursive: true })
    // Missing destination: copied verbatim, including nested directories.
    fs.writeFileSync(path.join(legacy, "only-legacy.json"), "{}")
    fs.writeFileSync(path.join(legacy, "project", "project.json"), '{"source":"legacy"}')
    fs.writeFileSync(path.join(current, "project", "current.json"), '{"source":"current"}')
    // Existing destination with a newer mtime: left untouched.
    fs.writeFileSync(path.join(legacy, "opencode.json"), '{"source":"legacy"}')
    fs.writeFileSync(path.join(current, "opencode.json"), '{"source":"current"}')
    const future = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(current, "opencode.json"), future, future)
    // Existing destination with an older mtime: replaced by the newer source.
    fs.writeFileSync(path.join(legacy, "newer.json"), '{"source":"legacy"}')
    fs.writeFileSync(path.join(current, "newer.json"), '{"source":"current"}')
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(path.join(current, "newer.json"), past, past)

    const result = acquire(root)

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(fs.readFileSync(path.join(current, "only-legacy.json"), "utf8")).toBe("{}")
    expect(fs.readFileSync(path.join(current, "project", "project.json"), "utf8")).toBe('{"source":"legacy"}')
    expect(fs.readFileSync(path.join(current, "project", "current.json"), "utf8")).toBe('{"source":"current"}')
    expect(fs.readFileSync(path.join(current, "opencode.json"), "utf8")).toBe('{"source":"current"}')
    expect(fs.readFileSync(path.join(current, "newer.json"), "utf8")).toBe('{"source":"legacy"}')
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("migrates only once", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))
    const legacy = path.join(root, "config", "theiacode")
    const current = path.join(root, "config", "opencode")
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, "opencode.json"), "{}")

    expect(acquire(root).exitCode).toBe(0)
    fs.writeFileSync(path.join(legacy, "later.json"), "{}")
    expect(acquire(root).exitCode).toBe(0)

    expect(fs.existsSync(path.join(current, "later.json"))).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("starts normally without a legacy theiacode directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))

    const result = acquire(root)

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(fs.statSync(path.join(root, "config", "opencode")).isDirectory()).toBe(true)
    // No legacy source means no marker is left behind, so a legacy directory
    // created later is still eligible for migration.
    expect(fs.existsSync(path.join(root, "config", "opencode", ".migrated-from-theiacode"))).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("skips migration when OPENCODE_CONFIG_DIR is set", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))
    const legacy = path.join(root, "config", "theiacode")
    const explicit = path.join(root, "explicit")
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, "opencode.json"), "{}")

    const result = acquire(root, { OPENCODE_CONFIG_DIR: explicit })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(fs.statSync(explicit).isDirectory()).toBe(true)
    expect(fs.existsSync(path.join(explicit, "opencode.json"))).toBe(false)
    expect(fs.existsSync(path.join(root, "config", "theiacode", ".migrated-from-theiacode"))).toBe(false)
    expect(fs.existsSync(path.join(root, "config", "opencode"))).toBe(false)
    fs.rmSync(root, { recursive: true, force: true })
  })

  test("seeds through layerWith, which the CLI runtime uses", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-global-migrate-"))
    const legacy = path.join(root, "config", "theiacode")
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, "opencode.json"), '{"legacy":true}')

    const result = acquire(root, {}, "Global.layerWith({})")

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(fs.readFileSync(path.join(root, "config", "opencode", "opencode.json"), "utf8")).toBe('{"legacy":true}')
    fs.rmSync(root, { recursive: true, force: true })
  })
})
function acquire(root: string, env: Record<string, string> = {}, build = "compile(Global.node)") {
  const directories = ["data", "cache", "config", "state", "tmp"].map((directory) => path.join(root, directory))
  const module = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
  const layerNode = pathToFileURL(path.join(import.meta.dir, "../src/effect/layer-node.ts")).href
  return Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `
        import { Context, Effect, Layer } from "effect"
        const { Global } = await import(${JSON.stringify(module)})
        const { compile } = await import(${JSON.stringify(layerNode)})
        const context = await Effect.runPromise(Effect.scoped(Layer.build(${build})))
        process.stdout.write(Context.get(context, Global.Service).tmp)
      `,
    ],
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      XDG_DATA_HOME: directories[0],
      XDG_CACHE_HOME: directories[1],
      XDG_CONFIG_HOME: directories[2],
      XDG_STATE_HOME: directories[3],
      // os.tmpdir() reads TMPDIR on POSIX and TEMP on Windows.
      TMPDIR: directories[4],
      TEMP: directories[4],
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
}
