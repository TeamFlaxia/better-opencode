import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"

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
    (frame) => frame.includes("Version control") && frame.includes("No Git, jj, or Mercurial repository"),
  )
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("Ask anything")
  expect(frame).not.toContain("OpenCode crashed")

  setup.mockInput.pressKey("q")
  await setup.waitForFrame((next) => next.includes("Ask anything"))
}, 20000)
