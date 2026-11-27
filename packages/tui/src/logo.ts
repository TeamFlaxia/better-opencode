// Cells are literal: "█" is ink and " " leaves the terminal background alone.
// `_`, `^` and `~` are shadow cells and are only used by the compact `go` mark.
export const logo = {
  left: [
    "████ █  █ ████ ████  ██ ",
    " ██  █  █ █     ██  █  █",
    " ██  ████ ███   ██  ████",
    " ██  █  █ █     ██  █  █",
    " ██  █  █ ████ ████ █  █",
  ],
  right: [
    " ███  ██  ███  ████",
    "█    █  █ █  █ █   ",
    "█    █  █ █  █ ███ ",
    "█    █  █ █  █ █   ",
    " ███  ██  ███  ████",
  ],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}
