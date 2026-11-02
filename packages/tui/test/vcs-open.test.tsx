import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

test("opens the full-pane version control view in place of the conversation", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { mode: "off" }, experimental: { "vcs-dock": true } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Ask anything"))

  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey("v")

  await setup.waitForFrame(
    (frame) => frame.includes("VCS") && frame.includes("No Git, jj, or Mercurial repository"),
  )
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Ask anything")
  expect(frame).not.toContain("OpenCode crashed")

  setup.mockInput.pressKey("q")
  await setup.waitForFrame((next) => next.includes("Ask anything"))
}, 20000)

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = (id: string, title: string) => ({
  id,
  title,
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
})

test("the version control view stays with its session tab", async () => {
  const first = session("ses_vcs_tab_a", "First tab")
  const second = session("ses_vcs_tab_b", "Second tab")
  const message = (text: string) => ({
    data: [{ id: `msg_${text}`, type: "user", text, time: { created: 1 } }],
    cursor: {},
  })
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID: first.id },
    config: { animations: false, tabs: { mode: "on" }, experimental: { "vcs-dock": true } },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [first, second], cursor: {} })
      if (url.pathname === `/api/session/${first.id}`) return json({ data: first })
      if (url.pathname === `/api/session/${second.id}`) return json({ data: second })
      if (url.pathname === `/api/session/${first.id}/message`) return json(message("Conversation A"))
      if (url.pathname === `/api/session/${second.id}/message`) return json(message("Conversation B"))
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Conversation A"))

  setup.mockInput.pressKey("x", { ctrl: true })
  setup.mockInput.pressKey("v")
  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository"))

  setup.events.emit({
    id: "evt_select_second",
    created: 2,
    type: "tui.session.select",
    data: { sessionID: second.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("Conversation B") && !frame.includes("No Git, jj, or Mercurial repository"))

  setup.events.emit({
    id: "evt_select_first",
    created: 3,
    type: "tui.session.select",
    data: { sessionID: first.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository") && !frame.includes("Conversation B"))
}, 20000)
