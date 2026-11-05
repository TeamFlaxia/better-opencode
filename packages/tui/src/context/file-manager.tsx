import type { LocationRef } from "@opencode/client"
import { createEffect, createMemo, createSignal } from "solid-js"
import { useConfig } from "../config"
import { errorMessage } from "../util/error"
import {
  decodeFilePreview,
  parentPath,
  toFileManagerEntries,
  type FileManagerEntry,
  type FileManagerPreview,
} from "../util/file-manager"
import { useClient } from "./client"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useLocation } from "./location"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"

/**
 * The file manager reads the current location through the filesystem API. It keeps one
 * relative directory path so the dock and the full-pane view share the same position.
 */
export const { use: useFileManager, provider: FileManagerProvider } = createSimpleContext({
  name: "FileManager",
  init: () => {
    const config = useConfig()
    const client = useClient()
    const data = useData()
    const route = useRoute()
    const location = useLocation()
    const sessionTabs = useSessionTabs()
    const enabled = () => config.data.experimental?.["file-manager"] === true
    const [path, setPath] = createSignal("")
    const [entries, setEntries] = createSignal<readonly FileManagerEntry[]>([])
    const [loading, setLoading] = createSignal(false)
    const [error, setError] = createSignal<string>()
    const [revision, setRevision] = createSignal(0)
    const sessionID = createMemo(() => {
      if (route.data.type === "session") return route.data.sessionID
      return sessionTabs.current()
    })
    const ref = createMemo<LocationRef | undefined>(() => {
      const id = sessionID()
      const session = id ? data.session.get(id) : undefined
      if (session) return session.location
      return location.ref ?? data.location.default()
    })
    const root = createMemo(() => ref()?.directory)
    const visible = () => enabled() && root() !== undefined

    let generation = 0
    const load = async (target: LocationRef, directory: string) => {
      const attempt = ++generation
      setLoading(true)
      try {
        const result = await client.api.file.list({
          location: { directory: target.directory },
          ...(directory ? { path: directory } : {}),
        })
        if (attempt !== generation) return
        setEntries(toFileManagerEntries(result.data))
        setError(undefined)
      } catch (cause) {
        if (attempt !== generation) return
        setEntries([])
        setError(errorMessage(cause))
      } finally {
        if (attempt === generation) setLoading(false)
      }
    }

    createEffect(() => {
      const target = ref()
      const directory = path()
      if (!enabled() || !target) {
        generation++
        setEntries([])
        setLoading(false)
        setError(undefined)
        return
      }
      void load(target, directory)
    })

    // A different session or location starts at the new root instead of carrying a path
    // that may not exist there.
    createEffect(() => {
      const directory = root()
      if (directory === undefined) return
      setPath("")
    })

    const refresh = async () => {
      if (!enabled()) return
      const target = ref()
      if (!target) return
      await load(target, path())
      setRevision((value) => value + 1)
    }
    const open = (next: string) => {
      setPath(next)
    }
    const up = () => {
      setPath((value) => parentPath(value))
    }
    const preview = async (file: string): Promise<FileManagerPreview> => {
      const target = ref()
      if (!target) return { text: "", bytes: 0, binary: false, truncated: false }
      const bytes = await client.api.file.read({ location: { directory: target.directory }, path: file })
      return decodeFilePreview(bytes)
    }

    return {
      visible,
      root,
      path,
      entries,
      loading,
      error,
      revision,
      open,
      up,
      refresh,
      preview,
    }
  },
})
