import { expect, test } from "bun:test"
import {
  decodeFilePreview,
  entryName,
  formatFileSize,
  parentPath,
  toFileManagerEntries,
} from "../../src/util/file-manager"

test("normalizes and sorts directory entries before files", () => {
  const entries = toFileManagerEntries([
    { path: "src/component/", type: "directory" },
    { path: "README.md", type: "file" },
    { path: "assets\\images\\", type: "directory" },
    { path: "bun.lock", type: "file" },
  ])

  expect(entries).toEqual([
    { path: "src/component", name: "component", type: "directory" },
    { path: "assets\\images", name: "images", type: "directory" },
    { path: "bun.lock", name: "bun.lock", type: "file" },
    { path: "README.md", name: "README.md", type: "file" },
  ])
  expect(entryName("src/component/")).toBe("component")
  expect(entryName("README.md")).toBe("README.md")
})

test("walks parent directories without leaving the root", () => {
  expect(parentPath("src/component")).toBe("src")
  expect(parentPath("src")).toBe("")
  expect(parentPath("")).toBe("")
  expect(parentPath("src\\component\\")).toBe("src")
})

test("formats file sizes", () => {
  expect(formatFileSize(0)).toBe("0 B")
  expect(formatFileSize(1023)).toBe("1023 B")
  expect(formatFileSize(1536)).toBe("1.5 KB")
  expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB")
})

test("decodes text previews and detects binary files", () => {
  const text = decodeFilePreview(new TextEncoder().encode("first\r\nsecond\n"))
  expect(text.binary).toBe(false)
  expect(text.truncated).toBe(false)
  expect(text.text).toBe("first\nsecond\n")
  expect(text.bytes).toBe(14)

  const binary = decodeFilePreview(new Uint8Array([0x61, 0x00, 0x62]))
  expect(binary.binary).toBe(true)
  expect(binary.text).toBe("")
  expect(binary.bytes).toBe(3)
})

test("limits previews by lines and bytes", () => {
  const manyLines = decodeFilePreview(new TextEncoder().encode(Array.from({ length: 2_100 }, () => "line").join("\n")))
  expect(manyLines.truncated).toBe(true)
  expect(manyLines.text.split("\n")).toHaveLength(2_000)

  const manyBytes = decodeFilePreview(new Uint8Array(300 * 1024).fill(0x61))
  expect(manyBytes.truncated).toBe(true)
  expect(manyBytes.bytes).toBe(300 * 1024)
  expect(manyBytes.text.length).toBeLessThanOrEqual(256 * 1024)
})
