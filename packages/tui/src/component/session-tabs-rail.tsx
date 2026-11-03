import { createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import type { SessionTabsController } from "./session-tabs"

export function SessionTabsRailControls(props: { width: number; tabs: SessionTabsController }) {
  const theme = useTheme()
  const keymap = Keymap.use()
  const [hovered, setHovered] = createSignal(false)
  let pressed = false
  const search = () => (props.tabs.search ? props.tabs.search() : keymap.dispatch("session.list"))
  return (
    <box
      width={props.width}
      height={1}
      flexShrink={0}
      flexDirection="row"
      justifyContent="center"
      backgroundColor={hovered() ? theme.background.raised.base : theme.background.base}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => {
        pressed = event.button === 0
        event.stopPropagation()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (event.button !== 0 || !pressed) return
        pressed = false
        search()
      }}
      onMouseDragEnd={() => (pressed = false)}
    >
      <text
        width={2}
        height={1}
        fg={hovered() ? theme.text.base : theme.text.muted}
        selectable={false}
        wrapMode="none"
      >
        ⌕
      </text>
    </box>
  )
}

export function SessionTabHalfRow(props: {
  top: number
  edge: "top" | "bottom"
  width: number
  color: RGBA
  background: RGBA
}) {
  return (
    <text
      position="absolute"
      top={props.top}
      left={0}
      width={props.width}
      height={1}
      zIndex={1}
      fg={props.color}
      bg={props.background}
      selectable={false}
      wrapMode="none"
    >
      {(props.edge === "top" ? "▄" : "▀").repeat(props.width)}
    </text>
  )
}
