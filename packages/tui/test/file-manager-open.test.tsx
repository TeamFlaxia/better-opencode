import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_file_manager",
  title: "Files demo",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

test("opens the file manager from the dock and the leader key", async () => {
  await using setup = await createAppFixture({
    width: 110,
    height: 32,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "on" }, experimental: { "file-manager": true } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/fs/list")
        return json({
          location,
          data: [
            { path: "src/", type: "directory" },
            { path: "README.md", type: "file" },
          ],
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("FILES") && frame.includes("tui") && frame.includes("2"))

  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey("f")
  await setup.waitForFrame(
    (frame) => frame.includes("File manager") && frame.includes("README.md") && frame.includes("Directory · 2"),
  )

  const view = setup.captureCharFrame()
  expect(view).toContain("src")
  expect(view).toContain("y copy path")

  setup.mockInput.pressKey("q")
  await setup.waitForFrame((frame) => frame.includes("FILES") && !frame.includes("Directory · 2"))
}, 20000)
