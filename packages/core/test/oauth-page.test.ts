import { describe, expect, test } from "bun:test"
import { OauthCallbackPage } from "../src/oauth/page"

describe("OauthCallbackPage", () => {
  test("renders Theia Code brand copy instead of the upstream name", () => {
    const successPage = OauthCallbackPage.success({ provider: "xAI", autoClose: false })
    expect(successPage).toContain("<title>Authorization successful · Theia Code</title>")
    expect(successPage).toContain(`<span class="wordmark">Theia Code</span>`)
    expect(successPage).toContain("Theia Code is now connected to xAI.")
    expect(successPage).not.toContain("OpenCode is now")
    expect(OauthCallbackPage.success()).toContain("Theia Code is now authorized.")

    const errorPage = OauthCallbackPage.error("boom", { provider: "MCP" })
    expect(errorPage).toContain("Theia Code couldn't finish connecting to MCP.")
    expect(errorPage).toContain("try again from Theia Code.")
    expect(errorPage).not.toContain("OpenCode is now")
  })

  test("escapes bootstrap options embedded in the inline script", () => {
    const html = OauthCallbackPage.bootstrap({
      provider: `xAI</script><script>alert("provider")</script>`,
      tokenPath: `/token</script><script>alert("path")</script>`,
    })

    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html).toContain(`xAI\\u003c/script>\\u003cscript>alert(\\\"provider\\\")\\u003c/script>`)
    expect(html).toContain(`/token\\u003c/script>\\u003cscript>alert(\\\"path\\\")\\u003c/script>`)
  })
})
