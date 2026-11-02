import { createMemo } from "solid-js"
import { useVcs } from "../context/vcs"
import { Keymap } from "../context/keymap"
import type { VcsMutation } from "../util/vcs"
import { errorMessage } from "../util/error"
import { useToast } from "../ui/toast"
import { type DialogContext, useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogSelect } from "../ui/dialog-select"
import { DialogVcsFiles } from "./dialog-vcs-files"
import { DialogVcsHunks } from "./dialog-vcs-hunks"

type VcsDialogAction =
  | "diff"
  | "describe"
  | "new"
  | "squash"
  | "abandon"
  | "bookmark"
  | "split"
  | "split_parallel"
  | "split_interactive"
  | "edit"
  | "stage"
  | "unstage"
  | "stage_hunks"
  | "unstage_hunks"
  | "fetch"
  | "push"
  | "commit"
  | "commit_all"
  | "pull"
  | "refresh"
  | "external"

export type DialogVcsController = Pick<
  ReturnType<typeof useVcs>,
  | "summary"
  | "refreshing"
  | "tool"
  | "refresh"
  | "openTool"
  | "openCommand"
  | "execute"
  | "hunks"
  | "applyHunks"
>

export function DialogVcs(props: { controller?: DialogVcsController }) {
  const vcs = props.controller ?? useVcs()
  const dialog = useDialog()
  const keymap = Keymap.use()
  const toast = useToast()
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
          ? [
              { title: "Split files into new change", value: "split" as const, description: "jj split" },
              {
                title: "Split files into parallel change",
                value: "split_parallel" as const,
                description: "jj split --parallel",
              },
            ]
          : []),
        {
          title: "Split interactively (jj editor)",
          value: "split_interactive" as const,
          description: "hunk-level split in a terminal",
        },
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
          ? [
              { title: "Stage files…", value: "stage" as const, description: "Stage selected files" },
              { title: "Stage hunks…", value: "stage_hunks" as const, description: "Stage selected hunks" },
            ]
          : []),
        ...(current.files.some((file) => file.staged)
          ? [
              { title: "Unstage files…", value: "unstage" as const, description: "Unstage selected files" },
              {
                title: "Unstage hunks…",
                value: "unstage_hunks" as const,
                description: "Unstage selected hunks",
              },
            ]
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
  const splitFiles = async (parallel: boolean) => {
    const files = summary()?.files ?? []
    if (files.length === 0) return
    const paths = await DialogVcsFiles.show(dialog, {
      title: parallel ? "Split files into parallel change" : "Split files into new change",
      description: "Select the files that move into the new change.",
      confirmLabel: "split",
      files,
    })
    if (!paths?.length) return
    prompt(
      "Split description",
      "Description for the new change",
      "",
      parallel ? "split_parallel" : "split",
      paths,
    )
  }
  const openHunks = async (file: string, staged: boolean) => {
    try {
      const patch = await vcs.hunks(file, staged)
      if (patch.hunks.length === 0) {
        toast.show({ variant: "info", message: `No hunks available for ${file}` })
        return
      }
      const selected = await DialogVcsHunks.show(dialog, {
        title: staged ? `Unstage hunks · ${file}` : `Stage hunks · ${file}`,
        description: "Select hunks with space, then confirm.",
        confirmLabel: staged ? "unstage" : "stage",
        patch,
      })
      if (!selected) return
      await vcs.applyHunks(selected, staged)
    } catch (error) {
      toast.show({
        variant: "error",
        title: "Failed to read hunks",
        message: errorMessage(error),
      })
    }
  }
  const chooseHunkFile = (staged: boolean) => {
    const files = (summary()?.files ?? []).filter((file) => (staged ? file.staged : file.unstaged))
    if (files.length === 0) return
    dialog.replace(() => (
      <DialogSelect
        title={staged ? "Unstage hunks · choose file" : "Stage hunks · choose file"}
        options={files.map((file) => ({ title: file.file, value: file.file }))}
        onSelect={(option) => {
          dialog.clear()
          void openHunks(option.value, staged)
        }}
      />
    ))
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
      void splitFiles(false)
      return
    }
    if (action === "split_parallel") {
      void splitFiles(true)
      return
    }
    if (action === "split_interactive") {
      dialog.clear()
      void vcs.openCommand("jj split", "jj", ["split", "-i"])
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
    if (action === "stage_hunks" || action === "unstage_hunks") {
      chooseHunkFile(action === "unstage_hunks")
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
