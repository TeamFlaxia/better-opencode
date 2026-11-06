# File manager

The file manager is a read-only browser for the current session location. It is an
experimental feature and enabled by default in the TUI; turn it off in Settings →
Features or by setting `experimental.file-manager` to `false`.

The core configuration schema leaves the experiment off by default, so non-TUI
clients must enable it explicitly. In `cli.json` or the Experiments dialog:

```json
{
  "experimental": {
    "file-manager": true
  }
}
```

## Where it lives

While the experiment is enabled, a small `FILES` dock joins the Task graph and VCS
docks beside the tab bar. It shows the root directory, the current relative path, and
the number of entries in the current directory. Click the dock or press `<leader>f` to
open the full-pane view. `/files` opens it from the prompt.

The full-pane view replaces the session transcript instead of opening a modal dialog,
so the tab bar and docks stay in place. Switching to another session tab closes the
view and shows that tab's conversation. Opening the VCS or Task graph view closes the
file manager, and opening the file manager closes those views.

## Layout

The left panel lists the direct children of the current directory. Directories come
first and use a `▸` marker; files follow. A `..` row appears below the root so the
parent directory is one `enter` away. The right panel previews the selected file.

The dock uses the same placement setting as the VCS dock (`vcs.placement`). It joins
the VCS dock in the right column when that dock is visible; otherwise it stays in the
row below the tab bar. On a narrow terminal the right column also falls back to that
row. Vertical tabs keep the dock at the bottom of the rail and collapse it to an `F`
icon with the entry count.

## Preview

Text files render with line numbers. The preview renders at most 256 KB and 2,000
lines from the server; a truncated preview is marked in the header. A file containing
a NUL byte in its first 8 KB is treated as binary and shows only its size.

The file manager does not write, rename, or delete files. It uses the location-scoped
`fs.list` and `fs.read` endpoints, so reads stay inside the session location. Use the
agent or your editor for mutations.

## Keys

| Key                   | Action                                            |
| --------------------- | ------------------------------------------------- |
| `<leader>f`           | Open the file manager                             |
| `/files`              | Open from the prompt                              |
| `↑` / `↓`, `j` / `k`  | Select an entry, or scroll the preview            |
| `pageup` / `pagedown` | Move by one page                                  |
| `home` / `g`          | Go to the first entry or the top of the preview   |
| `end`                 | Go to the last entry or the bottom of the preview |
| `enter`               | Open the selected directory, or focus the preview |
| `backspace` / `h`     | Go to the parent directory                        |
| `tab`                 | Switch between the list and the preview           |
| `left` / `right`      | Focus the list or the preview                     |
| `y`                   | Copy the selected absolute path                   |
| `r`                   | Refresh the directory and preview                 |
| `q` / `esc`           | Return to the conversation                        |

## Configuration

The file manager has no settings of its own. It reads the current session location and
uses `vcs.placement` for dock placement so the three docks stay aligned.

```jsonc
{
  "experimental": {
    "file-manager": true,
  },
  "vcs": {
    "placement": "right", // or "below"
  },
}
```
