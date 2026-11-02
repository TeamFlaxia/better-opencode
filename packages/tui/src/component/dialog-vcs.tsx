import { createMemo } from "solid-js"
import { useVcs } from "../context/vcs"
import { Keymap } from "../context/keymap"
import type { VcsMutation } from "../util/vcs"
import { type DialogContext, useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"

type VcsDialogAction =
  | "diff"
  | "describe"
  | "new"
  | "squash"
  | "abandon"
  | "bookmark"
  | "fetch"
  | "push"
  | "commit"
  | "pull"
  | "refresh"
  | "external"

export type DialogVcsController = Pick<
  ReturnType<typeof useVcs>,
  "summary" | "refreshing" | "tool" | "refresh" | "openTool" | "execute"
>

export function DialogVcs(props: { controller?: DialogVcsController }) {
  const vcs = props.controller ?? useVcs()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const summary = () => vcs.summary()
  const title = () => {
    const current = summary()
    return current ? `Version control · ${current.kind} ${current.label}` : "Version control"
  }
  const dirty = () => {
    const current = summary()
    if (!current) return ""
    if (current.conflict) return "conflict"
    return current.dirty === 0 ? "clean" : `${current.dirty} changed file${current.dirty === 1 ? "" : "s"}`
  }
  const options = createMemo(() => {
    const current = summary()
    if (!current) return []
    const actions: Array<{ title: string; value: VcsDialogAction; description?: string }> = [
      { title: "Review changes", value: "diff", description: dirty() },
    ]
    if (current.kind === "jj") {
      actions.push(
        {
          title: "Describe current change",
          value: "describe",
          description: current.description || current.detail,
        },
        { title: "Create new change", value: "new", description: "jj new" },
        { title: "Squash into parent", value: "squash", description: "jj squash" },
        { title: "Abandon current change", value: "abandon", description: "jj abandon @" },
        { title: "Set bookmark", value: "bookmark", description: "jj bookmark set" },
        { title: "Fetch from remote", value: "fetch", description: "jj git fetch" },
        { title: "Push bookmarks", value: "push", description: "jj git push" },
      )
    }
    if (current.kind === "git") {
      actions.push(
        { title: "Commit all changes", value: "commit", description: "git add -A && git commit" },
        { title: "Fetch", value: "fetch", description: "git fetch --all --prune" },
        { title: "Pull", value: "pull", description: "git pull --ff-only" },
        { title: "Push", value: "push", description: "git push" },
      )
    }
    const external = vcs.tool()
    if (external)
      actions.push({ title: `Open ${external.label}`, value: "external", description: "External TUI (optional)" })
    actions.push({ title: "Refresh status", value: "refresh" })
    return actions
  })
  const prompt = (title: string, placeholder: string, value: string, action: VcsMutation) => {
    dialog.replace(() => (
      <DialogPrompt
        title={title}
        placeholder={placeholder}
        value={value}
        onConfirm={(input) => {
          const next = input.trim()
          if (!next) return
          dialog.clear()
          void vcs.execute(action, next)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const confirm = (title: string, message: string, action: VcsMutation) => {
    dialog.replace(() => (
      <DialogConfirm
        title={title}
        message={message}
        onConfirm={() => void vcs.execute(action)}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const run = (action: VcsDialogAction) => {
    if (action === "diff") {
      dialog.clear()
      keymap.dispatch("diff.open")
      return
    }
    if (action === "refresh") {
      dialog.clear()
      void vcs.refresh()
      return
    }
    if (action === "external") {
      dialog.clear()
      void vcs.openTool()
      return
    }
    if (action === "describe") {
      prompt("Describe change", "Change description", summary()?.description ?? "", "describe")
      return
    }
    if (action === "bookmark") {
      prompt("Set bookmark", "Bookmark name", "", "bookmark")
      return
    }
    if (action === "commit") {
      prompt("Commit changes", "Commit message", "", "commit")
      return
    }
    if (action === "abandon") {
      confirm("Abandon change?", "The current change and its description will be abandoned.", "abandon")
      return
    }
    dialog.clear()
    void vcs.execute(action)
  }

  return (
    <DialogSelect title={title()} options={options()} onSelect={(option) => run(option.value)} />
  )
}

DialogVcs.show = (dialog: DialogContext) => dialog.replace(() => <DialogVcs />)
