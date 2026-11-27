import os from "os"
import path from "path"

const home = os.homedir()
const data = process.env.XDG_DATA_HOME || (home ? path.join(home, ".local", "share") : undefined)
const cache = process.env.XDG_CACHE_HOME || (home ? path.join(home, ".cache") : undefined)
const config = process.env.XDG_CONFIG_HOME || (home ? path.join(home, ".config") : undefined)
const state = process.env.XDG_STATE_HOME || (home ? path.join(home, ".local", "state") : undefined)

/**
 * The XDG base directories that root opencode's global paths.
 *
 * `configApp` names the application config directory when it differs from the
 * other roots, which keep using `app`.
 */
export function roots(app: string, configApp = app) {
  return {
    data: path.join(data!, app),
    cache: path.join(cache!, app),
    config: path.join(config!, configApp),
    state: path.join(state!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
