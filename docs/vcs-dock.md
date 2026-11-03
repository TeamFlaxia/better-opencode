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

For jj the dock reads the current change, commit, bookmarks, description, conflict
state, and changed file count from `jj log` and `jj diff --summary`. For Git and
Mercurial it uses the existing VCS API, so the dock reflects the same state as the
rest of OpenCode.

jj stores changes as Git commits. `jj describe` rewrites the current change's
message, which changes its commit ID while keeping the change ID. The Changes panel
shows both IDs and the dock menu can copy either one. The view does not render a
separate Git history; the colocated Git repository is jj's storage, not a second
repository to browse.

jj has no checked-out branch. The Status panel shows the working-copy change as
`@ <change ID>`, and bookmarks pointing at that change are listed separately. A `@`
marker in the bookmarks list means the bookmark points at the working-copy change; it
does not mean the bookmark is "checked out".

Click the dock (or run `vcs.open`) to open the built-in version control view.
The view replaces the session transcript instead of opening a modal dialog, so the
file list and diff stay visible while the tab bar and dock remain in place.
Switching to another session tab closes the view and shows that tab's conversation.

When a jj repository is colocated with Git, the view renders jj only. jj manages
the colocated Git repository, so listing both would repeat the same files, bookmarks,
and history. Git-backed operations such as fetch and push still run through jj.

The layout follows lazygit: **Status**, **Files**, **Bookmarks/Branches**, and
**Changes/Commits** are stacked on the left, and the focused panel opens its diff or
details in the main panel on the right. The focused panel uses the accent border and
takes extra height, while the others keep a minimum row so every list stays visible.
Status colors show clean, changed, and conflict states; file markers use the diff
colors; remote bookmarks use the informational color. The footer groups contextual
and global shortcuts on separate rows.

Polling updates the panels in place. A refresh keeps the previous list and preview
visible while the next fetch runs, so rows, selection, and scroll position do not
reset every refresh interval. Editing a file inside the current jj change updates the
file row and diff in place without clearing the panel, because the working-copy
commit ID is not part of the panel cache key. Moving the selection scrolls only enough
to keep the active row visible; it does not pin that row to the top of the panel.

Right-click the dock for quick links to the diff viewer, change and commit ID
copying, and the optional external tool.

## Keyboard

The view has four panels: **Status**, **Files**, **Bookmarks** / **Branches**, and
**Changes** / **Commits**. A jj repository fills the last two with bookmarks and the
change log; a Git repository fills them with branches and commits.

- `1` / `2` / `3` / `4`: focus status, files, bookmarks/branches, or changes/commits
- `tab` or `left` / `right`: cycle the focused panel
- `up` / `down` or `j` / `k`: select an entry in the focused panel
- `space`: stage or unstage the selected Git file
- `enter`: open the diff viewer for a file; edit a mutable bookmark/change; start a
  new change on top of an immutable one; or switch to a Git branch/commit
- `n`: create a bookmark/branch (at the selected change/commit in changes/commits)
- `b`: move the selected local bookmark to a revset; in changes/commits, choose a
  local bookmark to move to the selected revision
- `m`: rename the selected local bookmark/branch
- `x`: delete the selected local bookmark/branch
- `t`: track or untrack the selected remote bookmark
- `s` / `u`: track or untrack all remote bookmarks (jj only)
- `f` / `p` / `l`: fetch, push, and pull (`l` is Git only). Fetch and push ask for a
  remote when more than one is configured. jj fetch also asks what to fetch (all,
  tracked, bookmarks only, or tags only), and jj push asks for a local bookmark when
  necessary.
- `o`: open the optional external tool when one is installed
- `r`: refresh status
- `q` / `esc`: return to the conversation

Bookmarks are grouped into **Local** and **Remote** sections. Remote jj bookmarks
appear as `name@remote` and show whether they are tracked or untracked; `t` toggles
tracking. Their commits are normally immutable, so selecting one starts a new change
on top of it instead of editing it in place. The internal `git` remote is hidden
because it only mirrors local bookmarks. Remote bookmarks cannot be renamed, deleted,
moved, or pushed from the view.

File shortcuts appear in the footer: Git uses `c`, `a`, `h`, and `u`; jj uses `d`,
`s`, `b`, `a`, `e`, `v`, `w`, and `i`.

## Built-in actions

jj:

- Review changes in the OpenCode diff viewer
- Browse grouped local and remote bookmarks and history, editing mutable entries or
  starting a new change from an immutable one
- Show tracked/untracked state for remote bookmarks, toggle one, or track/untrack all
- Create, move, rename, and delete local bookmarks
- Describe the current change
- Create a new change
- Squash into the parent
- Abandon the current change
- Split selected files into a new change or a parallel change
- Split interactively with jj's diff editor in a terminal
- Edit an existing change by revset
- Set a bookmark
- Show multiple bookmarks at `@` on separate lines in the repository preview
- Copy the current change ID or commit ID from the dock menu
- Fetch from a selected remote with `jj git fetch --remote`, optionally limited to
  tracked refs, bookmarks, or tags
- Push a selected local bookmark to a selected remote with
  `jj git push --bookmark <name> --remote <remote>`; the view asks for the bookmark
  and remote when more than one is available, and shows the remote bookmark state

Git:

- Review changes
- Browse branches and history, and switch to a branch or commit
- Create, rename, and delete branches
- Commit staged changes with a message
- Stage everything and commit in one action
- Stage or unstage selected files
- Stage or unstage selected hunks
- Fetch, pull, and push a selected Git remote

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
