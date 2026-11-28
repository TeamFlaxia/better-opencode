import { createMemo, createSignal, For } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useI18n } from "../i18n"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { describeOS, describeTerminal } from "../util/system"
import { useTuiApp } from "../context/runtime"
import { useNewDesigns } from "../config"

export function DialogDebug() {
  const theme = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()
  const app = useTuiApp()
  const newDesigns = useNewDesigns()
  const { t } = useI18n()
  const [copied, setCopied] = createSignal(false)

  dialog.setSize("large")

  const entries = createMemo(() => {
    const model = local.model.current()
    return [
      { label: t("Version"), value: `${app.version} (${app.channel})` },
      { label: t("Date"), value: new Date().toISOString() },
      { label: t("OS"), value: describeOS() },
      { label: t("Terminal"), value: describeTerminal() },
      { label: t("Session ID"), value: route.data.type === "session" ? route.data.sessionID : "n/a" },
      { label: t("Model"), value: model ? `${model.providerID}/${model.modelID}` : "n/a" },
    ]
  })

  const copy = () => {
    const text = entries()
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join("\n")
    void clipboard
      .write(text)
      .then(() => {
        setCopied(true)
        toast.show({ message: t("Debug info copied to clipboard"), variant: "info" })
      })
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: newDesigns() ? "c" : "return", title: t("Copy debug info"), group: "Dialog", run: copy }],
  }))

  const copyAction = () => ({
    title: copied() ? t("✓ copied") : t("copy"),
    key: newDesigns() ? "c" : "enter",
    color: copied() ? theme.text.feedback.success.base : undefined,
    onTrigger: copy,
  })

  return (
    <DialogLayout
      header={<DialogHeader title={t("Debug")} description={t("Share this when reporting an issue")} />}
      footer={{
        actions: { primary: [copyAction()] },
        get children() {
          if (newDesigns()) return undefined
          return <text fg={theme.text.muted}>{t("Share this when reporting an issue.")}</text>
        },
      }}
    >
      {/* No click-to-copy here: releasing a mouse selection must trigger the
          global copy-on-select so users can copy a single value, e.g. the session id. */}
      <For each={entries()}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.text.muted}>
              {entry.label.padEnd(10)}
            </text>
            <text fg={theme.text.base} wrapMode="word">
              {entry.value}
            </text>
          </box>
        )}
      </For>
    </DialogLayout>
  )
}
