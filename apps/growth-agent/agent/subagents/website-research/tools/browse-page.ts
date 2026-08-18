import { defineTool } from "eve/tools";
import { z } from "zod";
import { browsePage } from "#lib/browse.ts";

// Renders a page in a real browser (ephemeral Vercel Sandbox microVM, see
// #lib/browse.ts) so this subagent can research JS-rendered sites that curl
// returns empty shells for. There is deliberately no `screenshot` input: eve
// 0.27.0 tool results are text/JSON-only (ToolModelOutput has no image part),
// so a screenshot could never reach the model — we skip capturing it rather
// than burning sandbox time on undeliverable pixels. Revisit if eve gains
// image tool-result parts.
export default defineTool({
  description: "Render a public web page in a real headless browser (ephemeral sandbox VM) and return its title, final URL after redirects, and an accessibility-tree snapshot of the rendered content. Use this for the customer's site and competitor pages, especially JS-heavy ones; each call costs sandbox time, so budget calls carefully and use curl for simple static fetches (robots.txt, sitemaps). If this tool errors because the browser sandbox is unavailable, fall back to curl.",
  inputSchema: z.object({
    url: z.string().min(1).describe("Absolute http(s) URL of the public page to render."),
  }),
  async execute(input) {
    const result = await browsePage({ url: input.url, screenshot: false });
    return {
      final_url: result.finalUrl,
      title: result.title,
      snapshot: result.snapshotText,
    };
  },
});
