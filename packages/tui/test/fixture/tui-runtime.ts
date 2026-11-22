import { resolve, type Info, type Resolved } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"

type ResolvedInput = Omit<Info, "attention" | "keybinds" | "leader"> & {
  attention?: Partial<Resolved["attention"]>
  keybinds?: Partial<TuiKeybind.Keybinds>
  leader?: { timeout?: number }
}

// Tests were written for the previous designs and theme, so they keep new designs off and use
// opencode-classic unless they choose otherwise.
export function createTuiResolvedConfig(input: ResolvedInput = {}) {
  return resolve(
    {
      language: "en",
      ...input,
      // Keep component tests on the pre-fork defaults even though the product defaults
      // now mirror the maintainer's current configuration.
      theme: { mode: "system", name: "opencode-classic", ...input.theme },
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
