import type { Project } from "@opencode/schema/project"
import path from "path"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"

/** Standalone project picker for the dashboard's project indicator. */
export function DialogProject(props: {
  projects: readonly Project.Info[]
  project?: Project.ID
  onCancel?: () => void
  onSelect: (project: Project.ID | undefined) => void
}) {
  const dialog = useDialog()
  return (
    <DialogSelect<Project.ID | undefined>
      title="Project"
      current={props.project}
      options={[
        { title: "All projects", value: undefined },
        ...props.projects.map((item) => ({
          title: item.name ?? path.basename(item.canonical),
          description: item.canonical,
          value: item.id,
        })),
      ]}
      renderFilter={props.projects.length > 0}
      onCancel={() => {
        props.onCancel?.()
        dialog.clear()
      }}
      onSelect={(option) => {
        props.onSelect(option.value)
        dialog.clear()
      }}
    />
  )
}
