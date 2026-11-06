import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { EffectFlock } from "@opencode/util/effect-flock"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { parse, type ParseError } from "jsonc-parser"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"
import { RetainedImage } from "./retained-image"
import { action, parseReleaseVersion, type Policy } from "./updater-action"
import { releaseAsset, releaseChecksum, releaseTarget, releaseURL, sha256 } from "./updater-release"
import { errorMessage } from "../util/error"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew", "winget"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }

export class UpgradeError extends Error {
  readonly title: string
  readonly detail: string
  readonly command?: string
  readonly retry: string

  constructor(
    input: {
      readonly title: string
      readonly detail: string
      readonly command?: string
      readonly retry: string
    },
    options?: ErrorOptions,
  ) {
    super(input.detail, options)
    this.name = "UpgradeError"
    this.title = input.title
    this.detail = input.detail
    this.command = input.command
    this.retry = input.retry
  }
}

const decodeVpPackages = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String }))),
)

const installNames: Record<Method, string> = {
  curl: "The OpenCode installer",
  npm: "npm",
  pnpm: "pnpm",
  bun: "Bun",
  yarn: "Yarn",
  vp: "Vite+",
  brew: "Homebrew",
  winget: "WinGet",
}

const wingetPackage = "Anomaly.OpenCode"
const wingetArgs = [
  "--id",
  wingetPackage,
  "--exact",
  "--source",
  "winget",
  "--accept-source-agreements",
  "--disable-interactivity",
]

function conciseDetail(input: string) {
  const lines = stripVTControlCharacters(input)
    .trim()
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const tail = lines.slice(-12).join("\n")
  const clipped = tail.length > 2_000
  const detail = clipped ? `…${tail.slice(-1_999)}` : tail
  if (!detail) return
  if (lines.length <= 12 && !clipped) return detail
  return `${detail}\n\nOutput shortened to the last 12 lines.`
}

function errorDetail(cause: unknown): string {
  if (cause instanceof AppProcess.AppProcessError) {
    const stderr = conciseDetail(cause.stderr ?? "")
    if (stderr) return stderr
    if (cause.cause !== undefined) return errorDetail(cause.cause)
    return cause.message
  }
  if (cause instanceof Error) {
    const detail = cause.cause === undefined ? undefined : errorDetail(cause.cause)
    if (!detail || detail === cause.message) return cause.message
    return `${cause.message}: ${detail}`
  }
  return errorMessage(cause)
}

function resultDetail(result: { code: number; stdout: string; stderr: string }) {
  return (
    conciseDetail(result.stderr) ??
    conciseDetail(result.stdout) ??
    `The command exited with code ${result.code} without any error output.`
  )
}

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined, Error>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: (method?: Method) => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  // The CLI only projects this host-level preference instead of initializing
  // the location-scoped server configuration graph.
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const flock = yield* EffectFlock.Service
  const installedVersion = yield* Ref.make(OPENCODE_VERSION)
  const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  const executable = yield* fs.realPath(process.execPath).pipe(Effect.orElseSucceed(() => process.execPath))
  const installedPackage = yield* Effect.gen(function* () {
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    // Source invocations run inside Bun or Node, which may themselves be npm packages.
    if (!/^@opencode(?:-ai)?\/cli(?:-node)?$/.test(manifest.name)) return
    if (Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable))
      return manifest.name
  }).pipe(Effect.orElseSucceed(() => undefined))
  // "opencode" is Homebrew Core's formula; the others are published to anomalyco/tap.
  const installedFormula = ["opencode", "opencode-beta", "opencode-v2"].find((name) =>
    executable.includes(`${path.sep}Cellar${path.sep}${name}${path.sep}`),
  )
  // WinGet extracts portable packages into a directory named after the package identifier.
  const installedWinget = /[\\/]winget[\\/]packages[\\/]anomaly\.opencode_/i.test(executable)

  const readPolicy = Effect.fnUntraced(function* () {
    const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "notify"
  })

  const exec = Effect.fnUntraced(function* (command: string[], timeout: Duration.Input = "30 seconds") {
    return yield* appProcess
      .run(ChildProcess.make(command[0], command.slice(1)), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        })),
      )
  })

  const curlPath = path.resolve(
    global.home,
    ".opencode",
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  )
  const curlBinary = yield* fs.realPath(curlPath).pipe(Effect.orElseSucceed(() => curlPath))

  const method = Effect.fnUntraced(function* () {
    if (executable === curlBinary) return "curl"
    if (installedFormula) return "brew"
    if (installedWinget) return "winget"
    if (!installedPackage) return

    const parts = executable.toLowerCase().split(path.sep).map((part) => part.replace(/^\./, ""))
    const checks: Array<{ method: Method; command: string[] }> = [
      { method: "npm", command: ["npm", "list", "-g", "--depth=0", installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
      { method: "vp", command: ["vp", "list", "-g", "--json", installedPackage] },
    ]
    checks.sort((a, b) => Number(parts.includes(b.method)) - Number(parts.includes(a.method)))
    const results = yield* Effect.forEach(
      checks,
      (check) =>
        exec(check.command).pipe(
          Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
          Effect.map((result) => ({ check, result })),
        ),
      { concurrency: "unbounded" },
    )
    return results.find((result) => {
      if (result.check.method !== "vp") return result.result.stdout.includes(installedPackage)
      // Vite+ repeats the filter in its successful no-match message, so substring detection would be a false positive.
      return Option.exists(decodeVpPackages(result.result.stdout), (packages) =>
        packages.some((item) => item.name === installedPackage),
      )
    })?.check.method
  })

  const removalCommand = (method: Method) => {
    if (method === "winget") return ["winget", "uninstall", ...wingetArgs]
    if (method === "curl" || method === "brew" || !installedPackage) return undefined
    const commands = {
      npm: ["npm", "uninstall", "--global", installedPackage],
      pnpm: ["pnpm", "remove", "--global", installedPackage],
      bun: ["bun", "remove", "--global", installedPackage],
      yarn: ["yarn", "global", "remove", installedPackage],
      vp: ["vp", "uninstall", "-g", installedPackage],
    }
    return commands[method]
  }

  const removal = (method: Method) => {
    const command = removalCommand(method)
    if (!command) return undefined
    return {
      command,
      run: retaining(
        method,
        exec(command, "5 minutes").pipe(
          Effect.flatMap((result) => (result.code === 0 ? Effect.void : Effect.fail(new Error(resultDetail(result))))),
        ),
        global.tmp,
      ),
    }
  }

  const release = Effect.fnUntraced(function* (method?: Method) {
    const core = method === "brew" && installedFormula === "opencode"
    // A curl install is a better-opencode build, so it follows the fork's GitHub releases.
    // Homebrew and package-manager installs keep the upstream release service.
    if (method === "curl" || method === undefined) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch("https://api.github.com/repos/TeamFlaxia/better-opencode/releases?per_page=20", {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          }),
        catch: (cause) =>
          new UpgradeError(
            {
              title: "Could not check for OpenCode updates",
              detail: errorDetail(cause),
              retry: "Check your network, then run opencode upgrade again.",
            },
            { cause },
          ),
      })
      if (!response.ok)
        return yield* Effect.fail(
          new UpgradeError({
            title: "Could not check for OpenCode updates",
            detail: `The better-opencode release service returned HTTP ${response.status}.`,
            retry: "Try again in a few minutes.",
          }),
        )
      const releases: Array<{ tag_name?: string; draft?: boolean; prerelease?: boolean }> = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new UpgradeError(
            {
              title: "Could not read the OpenCode update information",
              detail: errorDetail(cause),
              retry: "Try again in a few minutes.",
            },
            { cause },
          ),
      })
      const stable = channel === "latest" || channel === "prod"
      const selected = releases.find(
        (release) =>
          !release.draft &&
          (!stable || !release.prerelease) &&
          typeof release.tag_name === "string" &&
          parseReleaseVersion(release.tag_name),
      )
      if (!selected?.tag_name) return { package: "opencode", version: OPENCODE_VERSION }
      return { package: "opencode", version: selected.tag_name.replace(/^v/, "") }
    }
    const distribution = method === "brew" ? "homebrew" : "npm"
    // Homebrew Core builds its formula on its own schedule, so the tap release does not describe it.
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(
          core
            ? "https://formulae.brew.sh/api/formula/opencode.json"
            : `https://opencode.ai/update/api/${encodeURIComponent(channel)}/${encodeURIComponent(OPENCODE_ARTIFACT)}/${distribution}?current=${encodeURIComponent(OPENCODE_VERSION)}`,
          {
            signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          },
        ),
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not check for OpenCode updates",
            detail: errorDetail(cause),
            retry: "Check your network, then run opencode upgrade again.",
          },
          { cause },
        ),
    })
    if (!response.ok)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not check for OpenCode updates",
          detail: `The update service returned HTTP ${response.status}.`,
          retry: "Try again in a few minutes.",
        }),
      )
    const data: { version?: string; metadata?: { package?: string }; versions?: { stable?: string } } =
      yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new UpgradeError(
            {
              title: "Could not read the OpenCode update information",
              detail: errorDetail(cause),
              retry: "Try again in a few minutes.",
            },
            { cause },
          ),
      })
    const version = core ? data.versions?.stable : data.version
    const packageName = core ? "opencode" : data.metadata?.package
    if (!version || !packageName)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not read the OpenCode update information",
          detail: "The update service returned incomplete release information.",
          retry: "Try again in a few minutes.",
        }),
      )
    return { package: packageName, version }
  })

  // WinGet moderates every submission, so only its own index knows which release it can install.
  const wingetVersion = Effect.fnUntraced(function* () {
    const failure = (detail: string, cause?: unknown) =>
      new UpgradeError(
        {
          title: "Could not check for OpenCode updates",
          detail,
          command: ["winget", "search", ...wingetArgs].join(" "),
          retry: "Fix the issue above, then run opencode upgrade again.",
        },
        cause === undefined ? undefined : { cause },
      )
    const result = yield* exec(["winget", "search", ...wingetArgs], "1 minute").pipe(
      Effect.mapError((cause) => failure(errorDetail(cause), cause)),
    )
    // Column headers are localized, but the result row always lists the identifier followed by the version.
    const version = result.stdout
      .split(/\r?\n|\r/)
      .map((line) => line.trim().split(/\s+/))
      .flatMap((tokens) => {
        const index = tokens.findIndex((token) => token.toLowerCase() === wingetPackage.toLowerCase())
        return index === -1 ? [] : tokens.slice(index + 1, index + 2)
      })
      .find((token) => parseReleaseVersion(token))
    if (result.code !== 0 || !version) return yield* Effect.fail(failure(resultDetail(result)))
    return version
  })

  const latest = (selected?: Method) =>
    (selected ? Effect.succeed(selected) : method()).pipe(
      Effect.flatMap((method) =>
        method === "winget" ? wingetVersion() : release(method).pipe(Effect.map((data) => data.version)),
      ),
    )

  const temporaryDirectory = (prefix: string) =>
    Effect.acquireRelease(fs.makeTempDirectory({ directory: global.cache, prefix }), (directory) =>
      fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
    )

  // On Windows the installer must delete or replace the running binary, which only works
  // while another link to it exists (see RetainedImage). Upgrades keep that link in the
  // cache; uninstall has already removed the cache, so it uses the temporary directory.
  const retaining = <A, E, R>(method: Method, effect: Effect.Effect<A, E, R>, directory = global.cache) => {
    if (process.platform !== "win32" || method === "brew") return effect
    // Only the installed binary is at stake; source checkouts run inside bun or node.
    const owned =
      method === "curl"
        ? executable === curlBinary
        : method === "winget"
          ? installedWinget
          : installedPackage !== undefined
    if (!owned) return effect
    return Effect.scoped(RetainedImage.retain(directory, "upgrade").pipe(Effect.andThen(effect))).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    )
  }

  const runUpgrade = (input: {
    readonly method: Method
    readonly command: string[]
    readonly displayCommand?: string[]
    readonly title?: string
    readonly retry?: string
  }) => {
    const failure = (detail: string, cause?: unknown) =>
      new UpgradeError(
        {
          title: input.title ?? `${installNames[input.method]} could not install OpenCode`,
          detail,
          command: (input.displayCommand ?? input.command).join(" "),
          retry: input.retry ?? "Fix the issue above, then run opencode upgrade again.",
        },
        cause === undefined ? undefined : { cause },
      )
    return exec(input.command, "5 minutes").pipe(
      Effect.flatMap((result) =>
        result.code === 0 ? Effect.succeed(result) : Effect.fail(failure(resultDetail(result))),
      ),
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : failure(
              cause instanceof AppProcess.AppProcessError && cause.stderr === undefined && cause.cause === undefined
                ? `Failed to update with ${input.method}`
                : errorDetail(cause),
              cause,
            ),
      ),
    )
  }

  const windowsBaseline = Effect.fnUntraced(function* () {
    const script = `(Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)`
    const run = (command: string) =>
      exec([command, "-NoProfile", "-NonInteractive", "-Command", script]).pipe(Effect.orElseSucceed(() => undefined))
    const result = (yield* run("powershell.exe")) ?? (yield* run("pwsh"))
    if (!result) return true
    const value = result.stdout.replace(/\s+/g, "").replaceAll("\r", "").toLowerCase()
    return value !== "true" && value !== "1"
  })

  // The standalone binary is installed from the fork's GitHub release archives. Match the
  // published asset names, including the baseline (no AVX2) and musl variants.
  const detectTarget = Effect.fnUntraced(function* () {
    const platform = process.platform
    let arch = process.arch
    // An x64 build under Windows ARM64 or Rosetta reports x64; prefer the native arm64 archive.
    if (platform === "win32" && arch === "x64" && /ARM64/i.test(process.env.PROCESSOR_IDENTIFIER ?? "")) arch = "arm64"
    if (platform === "darwin" && arch === "x64") {
      const translated = yield* exec(["sysctl", "-n", "sysctl.proc_translated"]).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (translated?.code === 0 && translated.stdout.trim() === "1") arch = "arm64"
    }
    const baseline =
      arch !== "x64"
        ? false
        : platform === "linux"
          ? !/\bavx2\b/.test(yield* fs.readFileString("/proc/cpuinfo").pipe(Effect.orElseSucceed(() => "")))
          : platform === "darwin"
            ? yield* exec(["sysctl", "-n", "hw.optional.avx2_0"]).pipe(
                Effect.map((result) => result.code !== 0 || result.stdout.trim() !== "1"),
                Effect.orElseSucceed(() => true),
              )
            : platform === "win32"
              ? yield* windowsBaseline()
              : false
    const musl =
      platform === "linux" &&
      ((yield* fs.exists("/etc/alpine-release").pipe(Effect.orElseSucceed(() => false))) ||
        (yield* exec(["ldd", "--version"]).pipe(
          Effect.map((result) => /musl/i.test(`${result.stdout}\n${result.stderr}`)),
          Effect.orElseSucceed(() => false),
        )))
    const target = releaseTarget({ platform, arch, baseline, musl })
    if (!target)
      return yield* Effect.fail(
        new UpgradeError({
          title: "OpenCode cannot update on this platform",
          detail: `No release archive is available for ${platform}/${arch}.`,
          retry: "Download a release for a supported platform from the project's GitHub releases.",
        }),
      )
    return target
  })

  const download = Effect.fnUntraced(function* (url: string) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          headers: { Accept: "application/octet-stream" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]),
        }),
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not download the OpenCode update",
            detail: errorDetail(cause),
            retry: "Check your network, then run opencode upgrade again.",
          },
          { cause },
        ),
    })
    if (!response.ok)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not download the OpenCode update",
          detail: `The release download returned HTTP ${response.status}.`,
          retry: "Try again in a few minutes.",
        }),
      )
    return yield* Effect.tryPromise({
      try: async () => new Uint8Array(await response.arrayBuffer()),
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not read the OpenCode update",
            detail: errorDetail(cause),
            retry: "Try again in a few minutes.",
          },
          { cause },
        ),
    })
  })

  const installRelease = Effect.fnUntraced(function* (version: string) {
    const target = yield* detectTarget()
    const file = releaseAsset(target, version)
    yield* fs.makeDirectory(global.cache, { recursive: true })
    const directory = yield* temporaryDirectory("update-")
    const [sums, bytes] = yield* Effect.all(
      [download(releaseURL(version, "SHA256SUMS.txt")), download(releaseURL(version, file))],
      { concurrency: "unbounded" },
    )
    const expected = releaseChecksum(new TextDecoder().decode(sums), file)
    if (!expected)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not verify the OpenCode update",
          detail: `${file} is missing from the release's SHA256SUMS.txt.`,
          retry: "Try again in a few minutes, or download the release manually.",
        }),
      )
    if (sha256(bytes) !== expected)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not verify the OpenCode update",
          detail: `The checksum for ${file} did not match the published SHA256SUMS.txt.`,
          retry: "Try again in a few minutes, or download the release manually.",
        }),
      )
    const archive = path.join(directory, file)
    yield* fs.writeFile(archive, bytes)
    yield* runUpgrade({
      method: "curl",
      command: ["tar", file.endsWith(".zip") ? "-xf" : "-xzf", archive, "-C", directory],
      title: "Could not extract the OpenCode update",
      retry: "Try again in a few minutes, or download the release manually.",
    })
    const extracted = path.join(directory, process.platform === "win32" ? "opencode.exe" : "opencode")
    if (!(yield* fs.exists(extracted).pipe(Effect.orElseSucceed(() => false))))
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not extract the OpenCode update",
          detail: `The ${file} archive did not contain an OpenCode binary.`,
          retry: "Try again in a few minutes, or download the release manually.",
        }),
      )
    // Stage beside the target so the rename stays on one filesystem and can replace a running
    // image on Windows (the retained link above keeps the old image alive).
    const staged = path.join(
      path.dirname(curlPath),
      `.opencode-update-${process.pid}-${randomBytes(4).toString("hex")}`,
    )
    yield* fs.makeDirectory(path.dirname(curlPath), { recursive: true })
    yield* Effect.ensuring(
      fs.copyFile(extracted, staged).pipe(
        // Zip extraction can drop the executable bit; the release binary must stay runnable.
        Effect.andThen(fs.chmod(staged, 0o755).pipe(Effect.orElseSucceed(() => undefined))),
        Effect.andThen(fs.rename(staged, curlPath)),
      ),
      fs.remove(staged).pipe(Effect.ignore),
    )
  })

  const upgrade = Effect.fnUntraced(function* (method: Method, input: string) {
    if (!parseReleaseVersion(input)) return yield* Effect.fail(new Error(`Invalid version: ${input}`))
    const version = input.trim().replace(/^v/, "")
    const packageName =
      method === "winget"
        ? wingetPackage
        : method === "brew" && installedFormula === "opencode"
          ? "opencode"
          : method === "curl"
            ? "opencode"
            : (yield* release(method)).package
    const target = `${packageName}@${version}`
    if (installedPackage && packageName !== installedPackage && (method === "pnpm" || method === "yarn")) {
      return yield* Effect.fail(new Error(`Reinstall ${target} with ${method} to migrate from ${installedPackage}.`))
    }
    const commands: Record<Exclude<Method, "bun" | "curl" | "brew" | "winget">, string[]> = {
      // Keep the old package: uninstalling it can unlink the replacement command.
      npm: [
        "npm",
        "install",
        "--global",
        ...((OPENCODE_ARTIFACT === "cli" && !installedPackage?.endsWith("/cli-node")) ||
        (installedPackage && packageName !== installedPackage)
          ? ["--force"]
          : []),
        target,
      ],
      pnpm: ["pnpm", "add", "--global", `--allow-build=${packageName}`, target],
      yarn: ["yarn", "global", "add", target],
      vp:
        installedPackage && packageName !== installedPackage
          ? ["vp", "install", "-g", "--force", target]
          : ["vp", "update", "-g", target],
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        // Other OpenCode processes may be installing at the same time. Wait longer than the
        // slowest install (curl runs two 5-minute commands).
        yield* flock.acquire("cli-upgrade", undefined, { timeoutMs: Duration.toMillis("15 minutes") })
        if (method === "bun") {
          // Bun does not prune old versions from its shared package cache.
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const cache = yield* temporaryDirectory("update-")
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: ["bun", "install", "--global", "--trust", "--cache-dir", cache, target],
              displayCommand: ["bun", "install", "--global", "--trust", target],
            }),
          )
        }
        if (method === "curl") return yield* retaining(method, installRelease(version))
        if (method === "brew") return yield* runUpgrade({ method, command: ["brew", "upgrade", packageName] })
        if (method === "winget")
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: [
                "winget",
                "upgrade",
                ...wingetArgs,
                "--version",
                version,
                "--silent",
                "--accept-package-agreements",
              ],
            }),
          )
        return yield* retaining(method, runUpgrade({ method, command: commands[method] }))
      }),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : new UpgradeError(
              {
                title: "Could not prepare the OpenCode upgrade",
                detail: errorDetail(cause),
                retry: "Fix the issue above, then run opencode upgrade again.",
              },
              { cause },
            ),
      ),
      Effect.asVoid,
    )
  })

  const inspect = Effect.fnUntraced(function* () {
    if (OPENCODE_LOCAL || ["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: OPENCODE_LOCAL ? "local-install" : "disabled",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      })
      return undefined
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return undefined
    }

    const current = yield* Ref.get(installedVersion)
    const version = yield* latest()
    yield* Effect.logInfo("update check", {
      current,
      latest: version,
    })
    const next = action(current, version, policy)
    if (next === "none") {
      yield* Effect.logInfo("update check done", { action: "up-to-date" })
      return undefined
    }
    yield* Effect.logInfo("OpenCode update available", { current, latest: version, action: next })
    return { policy, version }
  })

  const install = Effect.fnUntraced(function* (version: string) {
    const detected = yield* method()
    if (!detected) {
      yield* Effect.logWarning("update skipped: installation method not found")
      return false
    }
    const current = yield* Ref.get(installedVersion)
    yield* upgrade(detected, version)
    yield* Ref.set(installedVersion, version)
    yield* Effect.logInfo("updated OpenCode", { from: current, to: version, method: detected })
    return true
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    if (!(yield* install(version)))
      return yield* Effect.fail(
        new Error(
          "Could not detect the installation method. Update with your package manager or download the latest release.",
        ),
      )
  })

  const check = Effect.fn("cli.updater.check")(function* () {
    if (OPENCODE_LOCAL)
      return {
        type: "unavailable" as const,
        message: "This build runs from a source checkout. Use an installed OpenCode release to check for updates.",
      }
    const detected = yield* method()
    if (!detected)
      return {
        type: "unavailable" as const,
        message:
          "Could not detect the installation method. Update with your package manager or download the latest release.",
      }
    const version = yield* latest(detected)
    if (!parseReleaseVersion(version)) return yield* Effect.fail(new Error(`Invalid version: ${version}`))
    const current = yield* Ref.get(installedVersion)
    if (action(current, version, "auto") === "none") {
      // An earlier check may have installed the update while this client is still running.
      return action(OPENCODE_VERSION, current, "auto") === "none"
        ? undefined
        : { type: "installed" as const, version: current }
    }
    return { type: "available" as const, version }
  })

  const run = Effect.fn("cli.updater.run")(
    function* (onInstall: (version: string) => void = () => {}) {
      const result = yield* inspect()
      if (!result) return undefined
      if (result.policy === "notify") return { type: "available" as const, version: result.version }
      onInstall(result.version)
      if (!(yield* install(result.version))) return yield* Effect.fail(new Error("Installation method not found"))
      return { type: "installed" as const, version: result.version }
    },
    Effect.catch((error) => Effect.logWarning("update check failed", { error }).pipe(Effect.as(undefined))),
  )

  return Service.of({ run, check, apply, method, latest, upgrade, removal })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
