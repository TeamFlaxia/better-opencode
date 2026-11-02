import { describe, expect, test } from "bun:test"
import { parse } from "../src/highlights"

describe("highlights", () => {
  test("parses the v2.0.27 release notes", () => {
    const result = parse(
      [
        "### Highlights",
        "",
        "- **Built-In Worktree Tools**: Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create isolated worktrees, move sessions into them, and remove them with normal edit approval. ([#53981](https://github.com/anomalyco/opencode/pull/53981))",
        "- **Safer Remote Pairing**: The first `opencode pair --remote` now warns that it will expose your server and asks for confirmation. For non-interactive use, pass `opencode pair --remote --yes`. ([#54561](https://github.com/anomalyco/opencode/pull/54561))",
        "- **Installable Web App**: Use Chrome or Edge’s **Install** button to install the OpenCode web app, including when it runs behind an authenticating proxy. ([#53905](https://github.com/anomalyco/opencode/pull/53905))",
        "- **Clear Session Failures**: Desktop and TUI timelines now show execution errors that happen before or between model steps instead of ending without an explanation. ([#53826](https://github.com/anomalyco/opencode/pull/53826))",
        "- **Automatic Project Cleanup**: Projects whose directories no longer exist are automatically hidden from the project list. Opening the directory again restores the project. ([#54354](https://github.com/anomalyco/opencode/pull/54354))",
      ].join("\n"),
    )

    expect(result.problems).toEqual([])
    expect(result.items.map((item) => item.title)).toEqual([
      "Built-In Worktree Tools",
      "Safer Remote Pairing",
      "Installable Web App",
      "Clear Session Failures",
      "Automatic Project Cleanup",
    ])
    expect(result.items[0].body).toBe(
      "Ask OpenCode to use `worktree_create`, `worktree_list`, and `worktree_remove` in Code Mode. You can create " +
        "isolated worktrees, move sessions into them, and remove them with normal edit approval.",
    )
    expect(result.items[2].body).toBe(
      "Use Chrome or Edge’s Install button to install the OpenCode web app, including when it runs behind an " +
        "authenticating proxy.",
    )
    expect(result.items.some((item) => item.body.includes("github.com") || item.body.includes("(["))).toBe(false)
  })

  test("joins wrapped lines and drops multiple trailing links", () => {
    const result = parse(
      [
        "### Highlights",
        "",
        "- **Reopen Closed Tabs:** Right-click the new-session button to bring back a session you closed by",
        "  mistake. ([#123](https://github.com/anomalyco/opencode/pull/123), [#124](https://github.com/anomalyco/opencode/pull/124))",
        "* **Faster [Search](https://example.com)**: Results now stream in.",
        "",
        "### Core",
        "",
        "- **Not a Highlight**: Ignored.",
      ].join("\n"),
    )

    expect(result).toEqual({
      items: [
        {
          title: "Reopen Closed Tabs",
          body: "Right-click the new-session button to bring back a session you closed by mistake.",
        },
        { title: "Faster Search", body: "Results now stream in." },
      ],
      problems: [],
    })
  })

  test("returns nothing without a Highlights section", () => {
    expect(parse("### Core\n\n- Fixed a bug.")).toEqual({ items: [], problems: [] })
  })

  test("reports malformed highlights instead of failing", () => {
    const result = parse("### Highlights\n\n- Plain bullet without a title.\n")
    expect(result.items).toEqual([])
    expect(result.problems).toHaveLength(2)
  })

  test("limits the number and length of highlights", () => {
    const result = parse(
      [
        "### Highlights",
        ...Array.from({ length: 7 }, (_, index) => `- **Item ${index}**: ${"word ".repeat(100)}`),
      ].join("\n"),
    )

    expect(result.items).toHaveLength(5)
    expect(result.items[0].body.length).toBeLessThanOrEqual(300)
    expect(result.items[0].body.endsWith("…")).toBe(true)
    expect(result.problems).toEqual(["Kept the first 5 of 7 highlights"])
  })
})
