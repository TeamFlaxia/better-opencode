export type FileManagerEntryType = "file" | "directory"

export type FileManagerEntry = {
  readonly path: string
  readonly name: string
  readonly type: FileManagerEntryType
}

export type FileManagerPreview = {
  readonly text: string
  readonly bytes: number
  readonly binary: boolean
  readonly truncated: boolean
}

export const PREVIEW_BYTE_LIMIT = 256 * 1024
export const PREVIEW_LINE_LIMIT = 2_000

/**
 * The filesystem API reports entry paths relative to the location and appends the platform
 * separator to directories. Keep the reported separators so a Unix filename that contains a
 * backslash is not mistaken for a path, and strip only the trailing separator.
 */
export function normalizeEntryPath(value: string) {
  return value.replace(/[\\/]+$/, "")
}

export function entryName(value: string) {
  const normalized = normalizeEntryPath(value)
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return normalized.slice(index + 1) || normalized
}

export function parentPath(value: string) {
  const normalized = normalizeEntryPath(value)
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return index === -1 ? "" : normalized.slice(0, index)
}

export function toFileManagerEntries(
  entries: readonly { readonly path: string; readonly type: FileManagerEntryType }[],
): FileManagerEntry[] {
  return entries
    .map((entry) => {
      const path = normalizeEntryPath(entry.path)
      return { path, name: entryName(path), type: entry.type }
    })
    .toSorted((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1
      return left.name.localeCompare(right.name)
    })
}

export function decodeFilePreview(bytes: Uint8Array): FileManagerPreview {
  const sample = bytes.subarray(0, 8 * 1024)
  if (sample.includes(0)) return { text: "", bytes: bytes.byteLength, binary: true, truncated: false }

  const truncated = bytes.byteLength > PREVIEW_BYTE_LIMIT
  const text = new TextDecoder().decode(truncated ? bytes.subarray(0, PREVIEW_BYTE_LIMIT) : bytes)
  const lines = text.split("\n")
  const limited = lines.length > PREVIEW_LINE_LIMIT
  return {
    text: (limited ? lines.slice(0, PREVIEW_LINE_LIMIT) : lines).join("\n").replaceAll("\r\n", "\n"),
    bytes: bytes.byteLength,
    binary: false,
    truncated: truncated || limited,
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
