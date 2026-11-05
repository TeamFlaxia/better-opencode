import { resolve, type Info, type Resolved } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader?: { timeout?: number }
}

export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  return resolve(
    {
      language: "en",
      ...input,
      // Keep component tests on the pre-fork defaults even though the product defaults
      // now mirror the maintainer's current configuration.
      theme: { mode: "system", name: "opencode", ...input.theme },
      session: { sidebar: "auto", scrollbar: false, ...input.session },
      tabs: { mode: "auto", layout: "horizontal", ...input.tabs },
      experimental: {
        "vcs-dock": false,
        "task-graph": false,
        "file-manager": false,
        "client-mcp": false,
        "new-designs": false,
        ...input.experimental,
      },
    },
    { terminalSuspend: process.platform !== "win32", environment: {} },
  )
}
