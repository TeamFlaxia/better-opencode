/** Metadata for better-opencode features that can be enabled or disabled from Settings and the Experiments dialog. */
export type Feature = {
  id: string
  title: string
  description: string
  keywords: readonly string[]
}

export const features: Feature[] = [
  {
    id: "vcs-dock",
    title: "Version control dock",
    description: "Show jj or git status beside the tab bar and manage changes in a built-in panel",
    keywords: ["vcs", "git", "jj", "mercurial", "bookmarks", "dock"],
  },
  {
    id: "task-graph",
    title: "Task graph",
    description: "Show the agent's tasks, dependencies, and live execution as a chart",
    keywords: ["tasks", "graph", "dependencies", "goal", "plan", "chart"],
  },
  {
    id: "file-manager",
    title: "File manager",
    description: "Browse project files and preview them in a built-in panel",
    keywords: ["files", "browser", "explorer", "preview", "directory", "tree"],
  },
  {
    id: "client-mcp",
    title: "TUI tools",
    description: "Let the agent open terminals in this TUI (requires server support)",
    keywords: ["mcp", "tools", "terminal", "client"],
  },
  {
    id: "new-designs",
    title: "New designs",
    description: "Preview the new TUI designs",
    keywords: ["design", "preview", "ui"],
  },
]
