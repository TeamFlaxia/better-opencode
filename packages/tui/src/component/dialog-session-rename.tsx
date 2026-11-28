import { DialogPrompt } from "../ui/dialog-prompt"
import { type DialogContext, useDialog } from "../ui/dialog"
import { useClient } from "../context/client"
import { useI18n } from "../i18n"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"

export function DialogSessionRename(props: { sessionID: string; currentTitle?: string }) {
  const dialog = useDialog()
  const client = useClient()
  const toast = useToast()
  const { t } = useI18n()

  return (
    <DialogPrompt
      title={t("Rename session")}
      placeholder={t("Session title")}
      value={props.currentTitle}
      onConfirm={(value) => {
        const title = value.trim()
        if (!title) return
        void client.api.session
          .update({ sessionID: props.sessionID, title })
          .then(() => dialog.clear())
          .catch((error) =>
            toast.show({
              message: t("Failed to rename session: {{error}}", { error: errorMessage(error) }),
              variant: "error",
              duration: 5000,
            }),
          )
      }}
      onCancel={() => dialog.clear()}
    />
  )
}

DialogSessionRename.show = (dialog: DialogContext, sessionID: string, currentTitle?: string) =>
  dialog.replace(() => <DialogSessionRename sessionID={sessionID} currentTitle={currentTitle} />)
