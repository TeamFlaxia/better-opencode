# Version control dock

The TUI can keep a small version control status dock beside the tab bar. It is an
experimental feature, gated by the `vcs-dock` experiment and configured under `vcs`.

Operations run inside OpenCode: the dock does not require `lazygit`, `lazyjj`, or
`jjui` to be installed. Those tools remain available as an optional external view.

## Placement

- `right`: a two-row status segment at the right edge of the horizontal tab bar.
- `below`: a one-row status bar below the horizontal tab bar.

Vertical tabs always render the dock at the bottom of the rail, so the tab layout
keeps its width. The expanded dock is labelled `VCS`; the compact rail collapses it
to a `V` icon with the status count.

The right placement falls back to `below` on narrow terminals. The dock is only
shown when a repository is detected and session tabs are visible.

## Status

For jj the dock reads the current change, bookmarks, description, conflict state,
and changed file count from `jj log` and `jj diff --summary`. For Git and
Mercurial it uses the existing VCS API, so the dock reflects the same state as the
rest of OpenCode.

Click the dock (or run `vcs.open`) to open the built-in version control view.
The view replaces the session transcript instead of opening a modal dialog, so the
file list and diff stay visible while the tab bar and dock remain in place. The
view belongs to the current session tab: switching tabs hides it, and returning to
that tab brings it back.

When a jj repository is colocated with Git, the view lists both repositories and
their files together. Use `tab` or the left/right arrows to switch which repository
the action shortcuts target.

The layout follows lazygit's panel structure: a repositories panel, the active
files/branches/commits panel, and a preview panel. The list panel uses the accent
border to show where keyboard input goes, and the footer groups contextual and
global shortcuts on separate rows.

Right-click the dock for quick links to the diff viewer and the optional external
tool.

## Keyboard

The view has three panes: **files**, **branches**, and **history**. Both the jj and
Git panes are shown together; `tab` or `left` / `right` chooses which repository
the shortcuts target.

- `1` / `2` / `3`: switch between files, branches, and history
- `up` / `down` or `j` / `k`: select an entry
- `tab` or `left` / `right`: switch the active repository
- `space`: stage or unstage the selected Git file
- `enter`: open the diff viewer for a file, or switch to the selected branch/commit
- `n`: create a branch/bookmark (at the selected commit in history)
- `m`: rename the selected branch/bookmark
- `x`: delete the selected branch/bookmark
- `f` / `p` / `l`: fetch, push, and pull
- `o`: open the optional external tool
- `r`: refresh status
- `q` / `esc`: return to the conversation

File shortcuts appear in the footer: Git uses `c`, `a`, `h`, and `u`; jj uses `d`,
`s`, `b`, `a`, `e`, `v`, `w`, and `i`.

## Built-in actions

jj:

- Review changes in the OpenCode diff viewer
- Browse bookmarks and history, and switch to a bookmark or change
- Create, rename, and delete bookmarks
- Describe the current change
- Create a new change
- Squash into the parent
- Abandon the current change
- Split selected files into a new change or a parallel change
- Split interactively with jj's diff editor in a terminal
- Edit an existing change by revset
- Set a bookmark
- Fetch and push with the Git backend

Git:

- Review changes
- Browse branches and history, and switch to a branch or commit
- Create, rename, and delete branches
- Commit staged changes with a message
- Stage everything and commit in one action
- Stage or unstage selected files
- Stage or unstage selected hunks
- Fetch, pull, and push

The file and hunk pickers are multi-select lists: `space` toggles the current
item, `a` toggles all items, `enter` confirms, and `esc` cancels. Confirming
without an explicit selection uses the highlighted item.

Hunk staging uses the unstaged diff for staging and the staged diff with a
reverse apply for unstaging, so partially staged files keep both sides intact.
jj does not expose a non-interactive hunk split API; the interactive option opens
`jj split -i` in a terminal pane so jj's own diff editor can handle hunk-level
selection.

Actions run from the session directory. Git credential prompts are disabled, so a
private remote fails with an error toast instead of blocking the TUI.

## Optional external tools

The previous integration remains available when a tool is installed:

| Repository   | Preferred tool | Fallback |
| ------------ | -------------- | -------- |
| jj (`.jj`)   | `lazyjj`       | `jjui`   |
| Git (`.git`) | `lazygit`      | none     |

Set `vcs.tool` to force a tool. The view and dock expose the external tool only
when it is found on `PATH`.

`lazygit` is MIT, `jjui` is MIT, and `lazyjj` is Apache-2.0. If these binaries are
ever bundled with a release, their license texts and notices must ship with them.
The built-in view avoids that dependency entirely.

## Configuration

```jsonc
{
  "experimental": {
    "vcs-dock": true,
  },
  "vcs": {
    "placement": "right", // or "below"
    "tool": "auto", // optional: "lazygit", "lazyjj", "jjui"
    "refresh_interval": 5000,
  },
}
```

The experiment stays opt-in until the built-in actions cover the common jj and
Git workflows without surprising rewrites.
