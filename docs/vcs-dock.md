# Version control dock

The TUI can keep a small version control status dock beside the tab bar. It is an
experimental feature, gated by the `vcs-dock` experiment and configured under `vcs`.

## Why not only lazygit

`lazygit` is built around Git's index and branch model. A jj repository is
Git-compatible at the storage layer, but jj keeps the working copy as a real
commit and stores bookmarks outside Git. Running lazygit against a colocated jj
repository therefore shows an unfamiliar state and can create changes jj does
not expect.

The dock picks a tool that understands the detected repository:

| Repository | Preferred tool | Fallback |
| --- | --- | --- |
| jj (`.jj`) | `lazyjj` | `jjui` |
| Git (`.git`) | `lazygit` | none |
| Mercurial (`.hg`) | none | none |

Set `vcs.tool` to force a tool. For example, a jj user with only `jjui` installed
can set `"tool": "jjui"`.

## Placement

- `right`: a two-row status segment at the right edge of the horizontal tab bar.
- `below`: a one-row status bar below the horizontal tab bar.

Vertical tabs always render the dock at the bottom of the rail, so the tab layout
keeps its width.

The right placement falls back to `below` on narrow terminals. The dock is only
shown when a repository is detected and session tabs are visible.

## Status

For jj the dock reads the current change, bookmarks, description, conflict state,
and changed file count from `jj log` and `jj diff --summary`. For Git and
Mercurial it uses the existing VCS API, so the dock reflects the same state as the
rest of OpenCode.

Click the dock to open the preferred external tool in a terminal pane. Right-click
for a small menu with the external tool, the OpenCode diff viewer, copying the
change or branch identifier, and a manual refresh.

## Commands

- `vcs.open` (`<leader>v`): open the preferred external tool.
- `vcs.refresh`: refresh the dock status.
- `/vcs`: slash-command entry for `vcs.open`.

## Configuration

```jsonc
{
  "experimental": {
    "vcs-dock": true
  },
  "vcs": {
    "placement": "right", // or "below"
    "tool": "auto", // or "lazygit", "lazyjj", "jjui"
    "refresh_interval": 5000
  }
}
```

The experiment stays opt-in until the dock is useful without an external jj TUI.
