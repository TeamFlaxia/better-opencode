// Cells are literal: "█" is ink, "_" is the solid drop shadow behind the
// wordmark (offset one cell down-right), and " " leaves the background alone.
// Glyphs are six cells wide with one blank cell of tracking between letters.
// `^` is a shadow cell used by the compact `go` mark.
export const logo = {
  left: [
    "██████ ██  ██ ██████ ██████   ██   ",
    " _██___██████_██_____ _██___ █ _█  ",
    "  ██_  ██__██_████     ██_  ██████ ",
    "  ██_  ██_ ██_██████ ██████ ██__██_",
    "   __   __  __ ______ ______ __  __",
  ],
  right: [
    " █████  ████  █████  ██████ ",
    "██_____██__██ ██__██ ██_____",
    "██_    ██_ ██_██_ ██_████   ",
    " █████  ████__█████__██████ ",
    "  _____  ____  _____  ______",
  ],
}

// Blank columns the renderers leave between the two words.
export const logoGap = 3

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}
