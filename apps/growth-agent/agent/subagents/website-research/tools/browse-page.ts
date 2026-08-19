import { defineTool } from "eve/tools";
import { z } from "zod";
import { browsePageWithCurlFallback } from "#lib/browse.ts";

// Renders a page in a real browser (ephemeral Vercel Sandbox microVM, see
// #lib/browse.ts) so this subagent can research JS-rendered sites that curl
// returns empty shells for. There is deliberately no `screenshot` input:
// this research tool needs compact text, while screenshot bytes are persisted
// separately by capture-homepage-screenshot for later image-capable consumers.
export default defineTool({
  description: "Render a public web page in a real headless browser and return its title, final URL after redirects, and an accessibility-tree snapshot. If Chromium is unavailable, this tool automatically fetches the page with curl through the SSRF-hardened session sandbox and clearly labels the static-HTML result. Use this for the customer's site and competitor pages, especially JS-heavy ones; each browser call costs sandbox time, so budget calls carefully.",
  inputSchema: z.object({
    url: z.string().min(1).describe("Absolute http(s) URL of the public page to render."),
  }),
  async execute(input, ctx) {
    const result = await browsePageWithCurlFallback({
      url: input.url,
      requestId: ctx.callId,
      getSandbox: async () => await ctx.getSandbox(),
    });
    return {
      final_url: result.finalUrl,
      title: result.title,
      snapshot: result.snapshotText,
    };
  },
});
