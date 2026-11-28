/** @jsxImportSource @opentui/solid */
import { useRoute } from "../context/route"
import { ProjectDashboard } from "./dashboard"

/** Full-pane project dashboard opened from the dashboard dock. */
export function DashboardView(props: { onClose: () => void }) {
  const route = useRoute()
  return (
    <ProjectDashboard
      onClose={props.onClose}
      onOpenSession={(sessionID) => {
        props.onClose()
        route.navigate({ type: "session", sessionID })
      }}
    />
  )
}
