import { createMemo } from "solid-js"
import { useVcs } from "../context/vcs"
import { Keymap } from "../context/keymap"
import type { VcsMutation } from "../util/vcs"
import { type DialogContext, useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { DialogVcsFiles } from "./dialog-vcs-files"

type VcsDialogAction =
  | "diff"
  | "describe"
  | "new"
  | "squash"
  | "abandon"
  | "bookmark"
  | "split"
  | "edit"
  | "stage"
  | "unstage"
  | "fetch"
  | "push"
  | "commit"
  | "commit_all"
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
        ...(current.files.length
          ? [{ title: "Split files into new change", value: "split" as const, description: "jj split" }]
          : []),
        { title: "Edit change", value: "edit", description: "jj edit <revset>" },
        { title: "Set bookmark", value: "bookmark", description: "jj bookmark set" },
        { title: "Fetch from remote", value: "fetch", description: "jj git fetch" },
        { title: "Push bookmarks", value: "push", description: "jj git push" },
      )
    }
    if (current.kind === "git") {
      actions.push(
        { title: "Commit staged changes", value: "commit", description: "git commit -m" },
        { title: "Commit all changes", value: "commit_all", description: "git add -A && git commit" },
        ...(current.files.some((file) => file.unstaged)
          ? [{ title: "Stage files…", value: "stage" as const, description: "Stage selected files" }]
          : []),
        ...(current.files.some((file) => file.staged)
          ? [{ title: "Unstage files…", value: "unstage" as const, description: "Unstage selected files" }]
          : []),
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
  const prompt = (
    title: string,
    placeholder: string,
    value: string,
    action: VcsMutation,
    paths?: readonly string[],
  ) => {
    dialog.replace(() => (
      <DialogPrompt
        title={title}
        placeholder={placeholder}
        value={value}
        onConfirm={(input) => {
          const next = input.trim()
          if (!next) return
          dialog.clear()
          void vcs.execute(action, next, paths)
        }}
        onCancel={() => dialog.clear()}
      />
    ))
  }
  const splitFiles = async () => {
    const files = summary()?.files ?? []
    if (files.length === 0) return
    const paths = await DialogVcsFiles.show(dialog, {
      title: "Split files into new change",
      description: "Select the files that move into the new change.",
      confirmLabel: "split",
      files,
    })
    if (!paths?.length) return
    prompt("Split description", "Description for the new change", "", "split", paths)
  }
  const stageFiles = async (staged: boolean) => {
    const files = (summary()?.files ?? []).filter((file) => (staged ? file.staged : file.unstaged))
    if (files.length === 0) return
    const paths = await DialogVcsFiles.show(dialog, {
      title: staged ? "Unstage files" : "Stage files",
      description: staged ? "Select staged files to unstage." : "Select unstaged files to stage.",
      confirmLabel: staged ? "unstage" : "stage",
      files,
    })
    if (!paths?.length) return
    void vcs.execute(staged ? "unstage" : "stage", undefined, paths)
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
    if (action === "commit" || action === "commit_all") {
      prompt(
        action === "commit_all" ? "Commit all changes" : "Commit staged changes",
        "Commit message",
        "",
        action,
      )
      return
    }
    if (action === "split") {
      void splitFiles()
      return
    }
    if (action === "edit") {
      prompt("Edit change", "Revset", "@-", "edit")
      return
    }
    if (action === "stage" || action === "unstage") {
      void stageFiles(action === "unstage")
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
