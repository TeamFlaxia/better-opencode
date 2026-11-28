import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useI18n } from "../i18n"

/** Top-level views selected by the workspace tab bar. */
export type WorkspaceTab = "chat" | "dashboard"

const tabs: ReadonlyArray<{ id: WorkspaceTab; label: string; compact: string }> = [
  { id: "chat", label: "Chat", compact: "Chat" },
  { id: "dashboard", label: "Dashboard", compact: "Dash" },
]

export function TabBar(props: { tab: WorkspaceTab; onSelect: (tab: WorkspaceTab) => void }) {
  const theme = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { t } = useI18n()
  // Drop the longer label before the bar can wrap or push content off narrow terminals.
  const compact = () => dimensions().width < 48
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.background.raised.base}>
      <For each={tabs}>
        {(tab) => {
          const active = () => props.tab === tab.id
          const [hovered, setHovered] = createSignal(false)
          return (
            <box
              height={1}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                active()
                  ? theme.background.action.primary.focused
                  : hovered()
                    ? theme.background.action.primary.hovered
                    : undefined
              }
              onMouseOver={() => setHovered(true)}
              onMouseOut={() => setHovered(false)}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                props.onSelect(tab.id)
              }}
            >
              <text fg={active() ? theme.text.action.primary.focused : theme.text.muted}>
                {t(compact() ? tab.compact : tab.label)}
              </text>
            </box>
          )
        }}
      </For>
      <box flexGrow={1} minWidth={0} />
    </box>
  )
}
