export * as UpdaterRelease from "./updater-release"

import { createHash } from "node:crypto"

export const repository = "TeamFlaxia/better-opencode"

export type ReleaseTarget = {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly baseline?: boolean
  readonly musl?: boolean
}

/** Resolves the release archive target from the platform, architecture, CPU, and libc. */
export function releaseTarget(input: ReleaseTarget) {
  const platform =
    input.platform === "win32"
      ? "windows"
      : input.platform === "darwin"
        ? "darwin"
        : input.platform === "linux"
          ? "linux"
          : undefined
  const arch =
    input.arch === "x64" || input.arch === "x86_64"
      ? "x64"
      : input.arch === "arm64" || input.arch === "aarch64"
        ? "arm64"
        : undefined
  if (!platform || !arch) return
  return `${platform}-${arch}${arch === "x64" && input.baseline ? "-baseline" : ""}${platform === "linux" && input.musl ? "-musl" : ""}`
}

/** Name of the archive published with a release for a target. */
export function releaseAsset(target: string, version: string) {
  return `opencode-${version}-${target}.${target.startsWith("linux-") ? "tar.gz" : "zip"}`
}

/** Download URL for a release file in the fork's GitHub release. */
export function releaseURL(version: string, file: string) {
  return `https://github.com/${repository}/releases/download/v${version}/${file}`
}

/** Finds a file's published SHA-256 in a SHA256SUMS.txt document. */
export function releaseChecksum(text: string, file: string) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match?.[2] === file) return match[1].toLowerCase()
  }
}

export function sha256(input: Uint8Array) {
  return createHash("sha256").update(input).digest("hex")
}
