import { NodeServices } from "@effect/platform-node"
import { EffectFlock } from "@opencode/util/effect-flock"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { expect, spyOn, test } from "bun:test"
import { Effect, FileSystem, Layer, PlatformError, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Updater } from "../src/services/updater"
import { releaseAsset, releaseChecksum, releaseTarget, sha256 } from "../src/services/updater-release"
import { testEffect } from "../../core/test/lib/effect"

const it = testEffect(NodeServices.layer)

declare const OPENCODE_CLI_NAME: string | undefined

// Release downloads are served by the fetch fixture below; the update flow verifies their checksum.
const releaseBinary = new TextEncoder().encode("release-binary")
const releaseDigest = sha256(releaseBinary)
const releaseTargets = [
  "linux-x64",
  "linux-x64-baseline",
  "linux-x64-musl",
  "linux-x64-baseline-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-x64-baseline",
  "darwin-arm64",
  "windows-x64",
  "windows-x64-baseline",
  "windows-arm64",
]
function releaseChecksums(version: string) {
  return releaseTargets
    .map((target) => `${releaseDigest}  opencode-${version}-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`)
    .join("\n")
}

function fixture(
  respond: (command: {
    readonly command: string
    readonly args: ReadonlyArray<string>
  }) => Partial<AppProcess.RunResult> & {
    error?: AppProcess.AppProcessError
  } = () => ({}),
  name = "@opencode/cli",
  failCleanup = false,
  releasePackage = name,
  formula?: string,
  executableOverride?: (root: string, home: string) => Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem>,
  checksums = releaseChecksums,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "opencode-updater-" })
    const execPath = process.execPath
    const modules = path.join(root, "node_modules")
    const executable = executableOverride
      ? yield* executableOverride(root, path.join(root, "home"))
      : formula
        ? path.join(root, "Cellar", formula, "2.0.20", "bin", "opencode")
        : path.join(modules, "@opencode", "cli", "bin", "opencode")
    yield* fs.makeDirectory(path.dirname(executable), { recursive: true })
    yield* fs.writeFileString(executable, "binary")
    if (!formula && !executableOverride)
      yield* fs.writeFileString(
        path.join(modules, "@opencode", "cli", "package.json"),
        JSON.stringify({ name, bin: { opencode: "bin/opencode" } }),
      )
    const requests: string[] = []
    // The updater uses global fetch; scope this replacement to each install test.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (input: string | URL | Request) => {
              const url = input instanceof Request ? input.url : input.toString()
              requests.push(url)
              if (new URL(url).hostname === "formulae.brew.sh") return Response.json({ versions: { stable: "2.0.21" } })
              if (new URL(url).hostname === "api.github.com")
                return Response.json([
                  { tag_name: "v2.3.4-beta.1", draft: true, prerelease: true },
                  { tag_name: "v2.3.4", draft: false, prerelease: true },
                  { tag_name: "v2.3.3", draft: false, prerelease: false },
                ])
              const parsed = new URL(url)
              if (parsed.hostname === "github.com" && parsed.pathname.includes("/releases/download/")) {
                const segments = parsed.pathname.split("/")
                const version = (segments.at(-2) ?? "").replace(/^v/, "")
                const file = segments.at(-1) ?? ""
                if (file === "SHA256SUMS.txt") return new Response(checksums(version))
                return new Response(releaseBinary)
              }
              return Response.json({ version: "2.3.4", metadata: { package: releasePackage } })
            },
            { preconnect: fetch.preconnect },
          ),
        ),
      ),
      (request) => Effect.sync(() => request.mockRestore()),
    )
    const global = Global.make({
      home: path.join(root, "home"),
      data: path.join(root, "data"),
      cache: path.join(root, "cache"),
      config: path.join(root, "config"),
      state: path.join(root, "state"),
      tmp: path.join(root, "tmp"),
      bin: path.join(root, "bin"),
      log: path.join(root, "log"),
      repos: path.join(root, "repos"),
    })
    const commands: string[][] = []
    const updater = yield* Updater.Service.pipe(
      Effect.provide(Updater.layer),
      Effect.provide(
        LayerNode.compile(EffectFlock.node, {
          replacements: [Global.node.replace(Layer.succeed(Global.Service, global))],
        }),
      ),
      Effect.provideService(Global.Service, global),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        remove: (target, options) =>
          failCleanup && target.startsWith(global.cache)
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "remove",
                  pathOrDescriptor: target,
                }),
              )
            : fs.remove(target, options),
        realPath: (input) => (input === execPath ? fs.realPath(executable) : fs.realPath(input)),
      }),
      Effect.provideService(
        AppProcess.Service,
        AppProcess.Service.of({
          ...spawner,
          run: (command) =>
            Effect.suspend(() => {
              if (command._tag !== "StandardCommand") return Effect.die("Unexpected piped install command")
              const args = command.args.map(String)
              commands.push([command.command, ...args])
              const result = respond({ command: command.command, args })
              if (result.error) return Effect.fail(result.error)
              return Effect.succeed({
                command: command.command,
                exitCode: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
                stdoutTruncated: false,
                stderrTruncated: false,
                ...result,
              })
            }),
          runStream: () => Stream.die("Unexpected streaming install command"),
        }),
      ),
    )
    return { updater, commands, requests, global, fs, executable }
  })
}

const windows = process.platform === "win32" ? it.live : it.live.skip
const unix = process.platform === "win32" ? it.live.skip : it.live

const installs = [
  { method: "npm", command: ["npm", "install", "--global", "--force", "@opencode/cli@2.3.4-beta.1"] },
  {
    method: "pnpm",
    command: ["pnpm", "add", "--global", "--allow-build=@opencode/cli", "@opencode/cli@2.3.4-beta.1"],
  },
  { method: "yarn", command: ["yarn", "global", "add", "@opencode/cli@2.3.4-beta.1"] },
  { method: "vp", command: ["vp", "update", "-g", "@opencode/cli@2.3.4-beta.1"] },
] as const

installs.forEach(({ method, command }) => {
  it.live(`${method} installs the explicit V2 package version without a leading v`, () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      yield* test.updater.upgrade(method, "v2.3.4-beta.1")
      expect(test.commands).toEqual([[...command]])
    }),
  )
})

it.live("vp force-installs a renamed V2 package that replaces the existing binary owner", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", false, "@opencode/cli-node")
    yield* test.updater.upgrade("vp", "v2.3.4-beta.1")
    expect(test.commands).toEqual([["vp", "install", "-g", "--force", "@opencode/cli-node@2.3.4-beta.1"]])
  }),
)

it.live("vp removes the package from its managed global store", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const removal = test.updater.removal("vp")
    if (!removal) return yield* Effect.die("Expected vp removal command")
    expect(removal.command).toEqual(["vp", "uninstall", "-g", "@opencode/cli"])
    yield* removal.run
    expect(test.commands).toEqual([["vp", "uninstall", "-g", "@opencode/cli"]])
  }),
)
;[0, 1].forEach((exitCode) => {
  it.live(`bun isolates and removes its install cache after exit ${exitCode}`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => {
        expect(command.command).toBe("bun")
        expect(existsSync(command.args[4])).toBe(true)
        return { exitCode, stderr: Buffer.from("bun install failed") }
      })
      const result = yield* test.updater.upgrade("bun", "v2.3.4-beta.1").pipe(Effect.flip, Effect.option)
      const cache = test.commands[0]?.[5]
      expect(cache).toStartWith(path.join(test.global.cache, "update-"))
      expect(test.commands).toEqual([
        ["bun", "install", "--global", "--trust", "--cache-dir", cache, "@opencode/cli@2.3.4-beta.1"],
      ])
      expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
      expect(result._tag).toBe(exitCode === 0 ? "None" : "Some")
      if (result._tag === "Some") expect(result.value.message).toBe("bun install failed")
    }),
  )
})

it.live("bun ignores install cache cleanup failures", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", true)
    yield* test.updater.upgrade("bun", "v2.3.4-beta.1")
    expect(test.commands).toHaveLength(1)
  }),
)
it.live("curl installs the fork's GitHub release archive and replaces the binary", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      (command) => {
        if (command.command !== "tar") return {}
        const archive = command.args[1]
        const directory = command.args[command.args.indexOf("-C") + 1]
        expect(existsSync(archive)).toBe(true)
        writeFileSync(path.join(directory, process.platform === "win32" ? "opencode.exe" : "opencode"), releaseBinary)
        return {}
      },
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (_root, home) =>
        Effect.succeed(path.join(home, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode")),
    )
    yield* test.updater.upgrade("curl", "v2.3.4")
    expect(test.commands.filter(([command]) => command === "tar")).toHaveLength(1)
    expect(readFileSync(test.executable)).toEqual(Buffer.from(releaseBinary))
    expect(test.requests.some((url) => url.endsWith("/SHA256SUMS.txt"))).toBe(true)
    expect(test.requests.some((url) => /opencode-2\.3\.4-.*\.(tar\.gz|zip)$/.test(url))).toBe(true)
    expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
  }),
)

it.live("curl reports an archive extraction failure and cleans its directory", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      (command) =>
        command.command === "tar" ? { exitCode: 1, stderr: Buffer.from("bad archive") } : {},
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (_root, home) =>
        Effect.succeed(path.join(home, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode")),
    )
    const error = yield* test.updater.upgrade("curl", "v2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("bad archive")
    expect(yield* test.fs.readDirectory(test.global.cache)).toEqual([])
  }),
)

it.live("curl verifies the published checksum before extracting", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      () => ({}),
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (_root, home) =>
        Effect.succeed(path.join(home, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode")),
      (version) => releaseChecksums(version).replaceAll(releaseDigest, "0".repeat(64)),
    )
    const error = yield* test.updater.upgrade("curl", "v2.3.4").pipe(Effect.flip)
    expect(error.message).toContain("did not match")
    expect(test.commands.filter(([command]) => command === "tar")).toHaveLength(0)
  }),
)

test("release targets and checksums match the published assets", () => {
  expect(releaseTarget({ platform: "linux", arch: "x64", baseline: true, musl: true })).toBe("linux-x64-baseline-musl")
  expect(releaseTarget({ platform: "linux", arch: "arm64", musl: true })).toBe("linux-arm64-musl")
  expect(releaseTarget({ platform: "darwin", arch: "x64", baseline: true })).toBe("darwin-x64-baseline")
  expect(releaseTarget({ platform: "win32", arch: "x64" })).toBe("windows-x64")
  expect(releaseTarget({ platform: "linux", arch: "s390x" })).toBeUndefined()
  expect(releaseAsset("linux-x64", "2.3.4")).toBe("opencode-2.3.4-linux-x64.tar.gz")
  expect(releaseAsset("windows-x64", "2.3.4")).toBe("opencode-2.3.4-windows-x64.zip")
  expect(releaseChecksum(releaseChecksums("2.3.4"), "opencode-2.3.4-linux-x64.tar.gz")).toBe(releaseDigest)
  expect(releaseChecksum(releaseChecksums("2.3.4"), "opencode-2.3.4-missing.tar.gz")).toBeUndefined()
})

it.live("invalid version targets never execute a command or create a cache", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    yield* Effect.forEach(Updater.methods, (method) =>
      Effect.forEach(
        ["", "latest", "2.3", "01.2.3", "vv2.3.4", "2.3.4; echo unsafe", "--global", "v2.3.4\n--force"],
        (version) =>
          Effect.gen(function* () {
            const error = yield* test.updater.upgrade(method, version).pipe(Effect.flip)
            expect(error.message).toBe(`Invalid version: ${version}`)
          }),
      ),
    )
    expect(test.commands).toEqual([])
    expect(yield* test.fs.exists(test.global.cache)).toBe(false)
  }),
)

it.live("install failures expose stderr and process errors do not report success", () =>
  Effect.gen(function* () {
    const failed = yield* fixture(() => ({ exitCode: 1, stderr: Buffer.from("  registry denied access\n") }))
    const error = yield* failed.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    const missing = yield* fixture(() => ({ error: new AppProcess.AppProcessError({ command: "npm" }) }))
    const unavailable = yield* missing.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(unavailable.message).toBe("Failed to update with npm")
    expect(failed.commands).toHaveLength(1)
    expect(missing.commands).toHaveLength(1)
  }),
)
;(["npm", "pnpm", "bun", "yarn", "vp", undefined] as const).forEach((method) => {
  it.live(`method detection identifies ${method ?? "an unknown installation"} using the V2 package`, () =>
    Effect.gen(function* () {
      const test = yield* fixture((command) => ({
        stdout: Buffer.from(
          command.command === method
            ? method === "vp"
              ? JSON.stringify([{ name: "@opencode/cli", version: "2.3.4" }])
              : "@opencode/cli@2.3.4"
            : command.command === "vp"
              ? "[]"
              : "opencode-ai@1.0.0",
        ),
      }))
      expect(yield* test.updater.method()).toBe(method)
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@opencode/cli"],
        ["pnpm", "list", "-g", "--depth=0", "@opencode/cli"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["vp", "list", "-g", "--json", "@opencode/cli"],
      ])
    }),
  )
})

it.live("method detection tolerates unavailable package managers", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) =>
      command.command === "yarn"
        ? { stdout: Buffer.from("@opencode/cli@2.3.4") }
        : { error: new AppProcess.AppProcessError({ command: command.command }) },
    )
    expect(yield* test.updater.method()).toBe("yarn")
    expect(test.commands).toHaveLength(5)
  }),
)

it.live("vp detection ignores no-match output that repeats the package name", () =>
  Effect.gen(function* () {
    const test = yield* fixture((command) => ({
      stdout: Buffer.from(command.command === "vp" ? "No global packages matching '@opencode/cli'." : ""),
    }))
    expect(yield* test.updater.method()).toBeUndefined()
  }),
)

it.live("Homebrew Core installs check and upgrade the Core formula", () =>
  Effect.gen(function* () {
    const test = yield* fixture(() => ({}), "@opencode/cli", false, "anomalyco/tap/opencode-v2", "opencode")
    expect(yield* test.updater.method()).toBe("brew")
    expect(yield* test.updater.latest()).toBe("2.0.21")
    yield* test.updater.upgrade("brew", "2.0.21")
    expect(test.commands).toEqual([["brew", "upgrade", "opencode"]])
    // An explicitly selected method keeps its own release source.
    expect(yield* test.updater.latest("npm")).toBe("2.3.4")
    expect(test.requests).toEqual([
      "https://formulae.brew.sh/api/formula/opencode.json",
      "https://opencode.ai/update/api/local/cli/npm?current=local",
    ])
  }),
)
;["opencode-v2", "opencode-beta"].forEach((formula) => {
  it.live(`Homebrew tap installs of ${formula} use the published tap formula`, () =>
    Effect.gen(function* () {
      const test = yield* fixture(() => ({}), "@opencode/cli", false, `anomalyco/tap/${formula}`, formula)
      expect(yield* test.updater.method()).toBe("brew")
      expect(yield* test.updater.latest()).toBe("2.3.4")
      yield* test.updater.upgrade("brew", "2.3.4")
      expect(test.commands).toEqual([["brew", "upgrade", `anomalyco/tap/${formula}`]])
      expect(test.requests).toEqual([
        "https://opencode.ai/update/api/local/cli/homebrew?current=local",
        "https://opencode.ai/update/api/local/cli/homebrew?current=local",
      ])
    }),
  )
})

it.live("curl installs check better-opencode GitHub releases", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      () => ({}),
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (_root, home) => Effect.succeed(path.join(home, ".opencode", "bin", "opencode")),
    )
    expect(yield* test.updater.method()).toBe("curl")
    // Draft releases never count, and local builds accept the newest published prerelease.
    expect(yield* test.updater.latest()).toBe("2.3.4")
    expect(test.requests).toEqual(["https://api.github.com/repos/TeamFlaxia/better-opencode/releases?per_page=20"])
  }),
)

const winget = (search: Partial<AppProcess.RunResult>) =>
  fixture(
    (command) => (command.args[0] === "search" ? search : {}),
    "@opencode/cli",
    false,
    "@opencode/cli",
    undefined,
    (root) =>
      Effect.succeed(
        path.join(
          root,
          "AppData",
          "Local",
          "Microsoft",
          "WinGet",
          "Packages",
          "Anomaly.OpenCode_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "opencode.exe",
        ),
      ),
  )
const wingetArgs = [
  "--id",
  "Anomaly.OpenCode",
  "--exact",
  "--source",
  "winget",
  "--accept-source-agreements",
  "--disable-interactivity",
]

it.live("WinGet installs check, upgrade, and remove the version in the WinGet index", () =>
  Effect.gen(function* () {
    const test = yield* winget({
      stdout: Buffer.from(
        "Name     Id               Version\r\n------------------------------\r\nOpenCode Anomaly.OpenCode 2.0.28\r\n",
      ),
    })
    expect(yield* test.updater.method()).toBe("winget")
    expect(yield* test.updater.latest()).toBe("2.0.28")
    yield* test.updater.upgrade("winget", "v2.0.28")
    const removal = test.updater.removal("winget")
    if (!removal) return yield* Effect.die("Expected winget removal command")
    yield* removal.run
    expect(test.commands).toEqual([
      ["winget", "search", ...wingetArgs],
      ["winget", "upgrade", ...wingetArgs, "--version", "2.0.28", "--silent", "--accept-package-agreements"],
      ["winget", "uninstall", ...wingetArgs],
    ])
    // WinGet moderates submissions, so the OpenCode release service may list a version WinGet cannot install yet.
    expect(test.requests).toEqual([])
  }),
)

it.live("WinGet update checks report a missing package instead of a version", () =>
  Effect.gen(function* () {
    const test = yield* winget({
      exitCode: -1978335212,
      stdout: Buffer.from("No package found matching input criteria.\r\n"),
    })
    const error = yield* test.updater.latest().pipe(Effect.flip)
    expect(error.message).toBe("No package found matching input criteria.")
  }),
)

// Links are named opencode-upgrade-<pid>-<random>.exe; read them from inside the installer run.
const links = (directory: string) =>
  existsSync(directory) ? readdirSync(directory).filter((name) => name.startsWith("opencode-")) : []
const upgradeLinks = (directory: string) =>
  links(directory).filter((name) => name.startsWith(`opencode-upgrade-${process.pid}-`))

windows("windows keeps a second link to the running binary in the cache while the installer runs", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture(() => {
      expect(readFileSync(layout.executable, "utf8")).toBe("binary")
      const held = upgradeLinks(layout.cache)
      expect(held).toHaveLength(1)
      expect(readFileSync(path.join(layout.cache, held[0]), "utf8")).toBe("binary")
      return {}
    })
    layout.executable = test.executable
    layout.cache = test.global.cache
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    // pid 999999999 does not exist; pid 4 is System, alive but not openable (EPERM).
    yield* test.fs.writeFileString(path.join(test.global.cache, "opencode-upgrade-999999999-dead.exe"), "exited")
    yield* test.fs.writeFileString(path.join(test.global.cache, "opencode-service-4-aa.exe"), "inaccessible")
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
    // The installed path never disappears; the extra link is released and only dead ones are swept.
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual(["opencode-service-4-aa.exe"])
  }),
)

windows("windows releases the link when the installer fails", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.cache)).toHaveLength(1)
      return { exitCode: 1, stderr: Buffer.from("registry denied access") }
    })
    layout.cache = test.global.cache
    const error = yield* test.updater.upgrade("npm", "2.3.4").pipe(Effect.flip)
    expect(error.message).toBe("registry denied access")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
    expect(links(test.global.cache)).toEqual([])
  }),
)

windows("windows keeps the uninstall link in the temporary directory, not the removed cache", () =>
  Effect.gen(function* () {
    const layout = { tmp: "" }
    const test = yield* fixture(() => {
      expect(upgradeLinks(layout.tmp)).toHaveLength(1)
      return {}
    })
    layout.tmp = test.global.tmp
    yield* test.fs.makeDirectory(test.global.cache, { recursive: true })
    const removal = test.updater.removal("bun")
    if (!removal) return yield* Effect.die("Expected bun removal command")
    yield* removal.run
    expect(test.commands).toEqual([["bun", "remove", "--global", "@opencode/cli"]])
    expect(links(test.global.cache)).toEqual([])
    expect(links(test.global.tmp)).toEqual([])
  }),
)

windows("windows links the curl binary while the release archive is extracted", () =>
  Effect.gen(function* () {
    const layout = { executable: "", cache: "" }
    const test = yield* fixture(
      (command) => {
        if (path.basename(command.command, ".exe") === "tar") {
          expect(readFileSync(layout.executable, "utf8")).toBe("binary")
          expect(upgradeLinks(layout.cache)).toHaveLength(1)
          const directory = command.args[command.args.indexOf("-C") + 1]
          writeFileSync(path.join(directory, "opencode.exe"), releaseBinary)
        }
        return {}
      },
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (_root, home) => Effect.succeed(path.join(home, ".opencode", "bin", "opencode.exe")),
    )
    layout.executable = test.executable
    layout.cache = test.global.cache
    const original = process.execPath
    process.execPath = layout.executable
    yield* Effect.addFinalizer(() => Effect.sync(() => (process.execPath = original)))
    expect(yield* test.updater.method()).toBe("curl")
    yield* test.updater.upgrade("curl", "2.3.4")
    expect(test.commands.filter(([command]) => path.basename(command, ".exe") === "tar")).toHaveLength(1)
    expect(yield* test.fs.readFileString(layout.executable)).toBe(new TextDecoder().decode(releaseBinary))
    expect(links(test.global.cache)).toEqual([])
  }),
)

unix("curl method detection resolves symlinked home directories", () =>
  Effect.gen(function* () {
    const test = yield* fixture(
      () => ({}),
      "@opencode/cli",
      false,
      "@opencode/cli",
      undefined,
      (root, home) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const realHome = path.join(root, "real-home")
          const bin = path.join(realHome, ".opencode", "bin", "opencode")
          yield* fs.makeDirectory(path.dirname(bin), { recursive: true })
          yield* fs.symlink(realHome, home)
          return bin
        }),
    )
    expect(yield* test.updater.method()).toBe("curl")
    expect(test.commands).toEqual([])
  }),
)

windows("windows leaves a source checkout's runtime alone", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    }, "not-opencode")
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(test.commands).toHaveLength(1)
  }),
)

unix("other platforms never link the running binary", () =>
  Effect.gen(function* () {
    const layout = { cache: "" }
    const test = yield* fixture(() => {
      expect(links(layout.cache)).toEqual([])
      return {}
    })
    layout.cache = test.global.cache
    yield* test.updater.upgrade("bun", "2.3.4")
    expect(yield* test.fs.readFileString(test.executable)).toBe("binary")
  }),
)

test("Node distribution honors the compile-time CLI name", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      import.meta.path,
      "--define",
      'OPENCODE_CLI_NAME="opencode2-node"',
      "--test-name-pattern",
      "^Node distribution resolves the published npm package$",
    ],
    {
      cwd: path.join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "pipe",
      // Bun 1.4 can reuse cached modules compiled with different --define values.
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    },
  )
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code, stderr).toBe(0)
  expect(stderr).toContain("1 pass")
})

if (typeof OPENCODE_CLI_NAME === "string" && OPENCODE_CLI_NAME === "opencode2-node") {
  it.live("Node distribution resolves the published npm package", () =>
    Effect.gen(function* () {
      const test = yield* fixture(
        (command) => ({
          stdout: Buffer.from(command.command === "npm" ? "@opencode/cli-node@2.3.4" : ""),
        }),
        "@opencode/cli-node",
      )
      expect(yield* test.updater.method()).toBe("npm")
      yield* test.updater.upgrade("npm", "v2.3.4")
      yield* test.updater.upgrade("pnpm", "v2.3.4")
      yield* test.updater.upgrade("vp", "v2.3.4")
      expect(test.commands).toEqual([
        ["npm", "list", "-g", "--depth=0", "@opencode/cli-node"],
        ["pnpm", "list", "-g", "--depth=0", "@opencode/cli-node"],
        ["bun", "pm", "ls", "-g"],
        ["yarn", "global", "list"],
        ["vp", "list", "-g", "--json", "@opencode/cli-node"],
        ["npm", "install", "--global", "@opencode/cli-node@2.3.4"],
        ["pnpm", "add", "--global", "--allow-build=@opencode/cli-node", "@opencode/cli-node@2.3.4"],
        ["vp", "update", "-g", "@opencode/cli-node@2.3.4"],
      ])
    }),
  )
}
