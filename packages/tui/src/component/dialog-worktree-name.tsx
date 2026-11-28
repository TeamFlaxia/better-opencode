import { Slug } from "@opencode/core/util/slug"
import { useNewDesigns } from "../config"
import { useI18n } from "../i18n"
import { type DialogContext } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"

export function DialogWorktreeName(props: { onConfirm: (name: string) => void }) {
  const newDesigns = useNewDesigns()
  const { t } = useI18n()
  return (
    <DialogPrompt
      title={t("Name worktree")}
      placeholder={t("Worktree name")}
      onConfirm={(value) => props.onConfirm(slugify(value) || Slug.create())}
      actions={[
        {
          title: newDesigns() ? t("generate name") : t("generate one"),
          command: "dialog.worktree.generate",
          commandTitle: t("Generate worktree name"),
          onTrigger: (prompt) => prompt.setValue(Slug.create()),
        },
      ]}
    />
  )
}

DialogWorktreeName.show = (dialog: DialogContext) =>
  new Promise<string | null>((resolve) => {
    dialog.replace(
      () => <DialogWorktreeName onConfirm={resolve} />,
      () => resolve(null),
    )
  })

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}
