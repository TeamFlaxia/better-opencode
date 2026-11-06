import { beforeEach, expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

// F6 opens VCS directly so these view tests never race the leader key's pending timeout. Mock key names are
// uppercase while keybinding config stays lowercase.
beforeEach(() => {
  // Drafts live in a process-wide stash. Another app file can leave a home draft that the home prompt
  // restores here, so clear it before each test renders its starting view.
  takeDraft(undefined)
})
test("opens the full-pane version control view in place of the conversation", async () => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    config: {
      animations: false,
      tabs: { mode: "off" },
      experimental: { "vcs-dock": true },
      keybinds: { "vcs.open": "f6" },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Ask anything"))

  // A key pressed before the keymap layers register is dropped, and the prompt footer only renders
  // its shortcuts once the keymap is live.
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  setup.mockInput.pressKey("F6")

  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository"))
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

test("switching session tabs closes the version control view", async () => {
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
    config: {
      animations: false,
      tabs: { mode: "on" },
      experimental: { "vcs-dock": true },
      keybinds: { "vcs.open": "f6" },
    },
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

  // A key pressed before the keymap layers register is dropped, and the prompt footer only renders
  // its shortcuts once the keymap is live.
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  setup.mockInput.pressKey("F6")
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
  await setup.waitForFrame((frame) => frame.includes("Conversation A") && !frame.includes("No Git, jj, or Mercurial repository"))
}, 20000)

for (const layout of ["vertical", "horizontal"] as const) {
test(`switching ${layout} tabs with the mouse leaves the version control view`, async () => {
  const first = session("ses_vcs_tab_click_a", "First click tab")
  const second = session("ses_vcs_tab_click_b", "Second click tab")
  const message = (text: string) => ({
    data: [{ id: `msg_${text}`, type: "user", text, time: { created: 1 } }],
    cursor: {},
  })
  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    args: { sessionID: first.id },
    config: {
      animations: false,
      tabs: { mode: "on", layout },
      experimental: { "vcs-dock": true },
      keybinds: { "vcs.open": "f6" },
    },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [first, second], cursor: {} })
      if (url.pathname === `/api/session/${first.id}`) return json({ data: first })
      if (url.pathname === `/api/session/${second.id}`) return json({ data: second })
      if (url.pathname === `/api/session/${first.id}/message`) return json(message("Click conversation A"))
      if (url.pathname === `/api/session/${second.id}/message`) return json(message("Click conversation B"))
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Click conversation A"))
  // Selecting a session once adds its tab; return to the first tab before opening VCS.
  setup.events.emit({
    id: "evt_click_select_second",
    created: 2,
    type: "tui.session.select",
    data: { sessionID: second.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("Click conversation B"))
  setup.events.emit({
    id: "evt_click_select_first",
    created: 3,
    type: "tui.session.select",
    data: { sessionID: first.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("Click conversation A"))

  // A key pressed before the keymap layers register is dropped, and the prompt footer only renders
  // its shortcuts once the keymap is live.
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository"))

  const rows = setup.captureCharFrame().split("\n")
  const row = rows.findIndex((line) => line.includes("Second click tab"))
  expect(row).toBeGreaterThanOrEqual(0)
  await setup.mockMouse.click(rows[row]!.indexOf("Second click tab") + 2, row)
  await setup.waitForFrame(
    (frame) => frame.includes("Click conversation B") && !frame.includes("No Git, jj, or Mercurial repository"),
  )
}, 20000)
}

test("ctrl+tab switches session tabs while the version control view is open", async () => {
  const first = session("ses_vcs_tab_key_a", "First key tab")
  const second = session("ses_vcs_tab_key_b", "Second key tab")
  const message = (text: string) => ({
    data: [{ id: `msg_${text}`, type: "user", text, time: { created: 1 } }],
    cursor: {},
  })
  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    args: { sessionID: first.id },
    config: {
      animations: false,
      tabs: { mode: "on", layout: "horizontal" },
      experimental: { "vcs-dock": true },
      keybinds: { "vcs.open": "f6" },
    },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [first, second], cursor: {} })
      if (url.pathname === `/api/session/${first.id}`) return json({ data: first })
      if (url.pathname === `/api/session/${second.id}`) return json({ data: second })
      if (url.pathname === `/api/session/${first.id}/message`) return json(message("Key conversation A"))
      if (url.pathname === `/api/session/${second.id}/message`) return json(message("Key conversation B"))
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Key conversation A"))
  setup.events.emit({
    id: "evt_key_select_second",
    created: 2,
    type: "tui.session.select",
    data: { sessionID: second.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("Key conversation B"))
  setup.events.emit({
    id: "evt_key_select_first",
    created: 3,
    type: "tui.session.select",
    data: { sessionID: first.id },
    location: { directory },
  })
  await setup.waitForFrame((frame) => frame.includes("Key conversation A"))

  // A key pressed before the keymap layers register is dropped, and the prompt footer only renders
  // its shortcuts once the keymap is live.
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository"))

  setup.mockInput.pressTab({ ctrl: true })
  await setup.waitForFrame(
    (frame) => frame.includes("Key conversation B") && !frame.includes("No Git, jj, or Mercurial repository"),
  )
}, 20000)

test("clicking the active conversation tab closes the version control view", async () => {
  const only = session("ses_vcs_active_tab", "Active conversation tab")
  const message = (text: string) => ({
    data: [{ id: `msg_${text}`, type: "user", text, time: { created: 1 } }],
    cursor: {},
  })
  await using setup = await createAppFixture({
    width: 110,
    height: 30,
    args: { sessionID: only.id },
    config: {
      animations: false,
      tabs: { mode: "on", layout: "vertical" },
      experimental: { "vcs-dock": true },
      keybinds: { "vcs.open": "f6" },
    },
    fetch: (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [only], cursor: {} })
      if (url.pathname === `/api/session/${only.id}`) return json({ data: only })
      if (url.pathname === `/api/session/${only.id}/message`) return json(message("Active conversation"))
      if (/^\/api\/session\/[^/]+\/(inbox|permission|form)$/.test(url.pathname)) return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Active conversation"))

  // A key pressed before the keymap layers register is dropped, and the prompt footer only renders
  // its shortcuts once the keymap is live.
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  setup.mockInput.pressKey("F6")
  await setup.waitForFrame((frame) => frame.includes("No Git, jj, or Mercurial repository"))

  const rows = setup.captureCharFrame().split("\n")
  const row = rows.findIndex((line) => line.includes("Active conversation tab"))
  expect(row).toBeGreaterThanOrEqual(0)
  await setup.mockMouse.click(rows[row]!.indexOf("Active conversation tab") + 2, row)
  await setup.waitForFrame(
    (frame) => frame.includes("Active conversation") && !frame.includes("No Git, jj, or Mercurial repository"),
  )
}, 20000)
