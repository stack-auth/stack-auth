import { defineTool } from "eve/tools";
import { z } from "zod";
import { browsePage } from "#lib/browse.ts";
import { saveArtifact } from "#lib/hexclave-client.ts";

/**
 * Captures a screenshot of the product's homepage and stores it as a `brand_screenshot` artifact.
 * Useful on its own for dashboard/human review, and it is the visual reference ad creative
 * generation reads once that lands. Capturing it once during research — rather than only ever live,
 * on demand, at generation time — means a screenshot still exists even for a project whose site
 * becomes unreachable later.
 *
 * The returned tool result carries no image bytes — only metadata. eve 0.27.0's ToolModelOutput is
 * text/JSON only (see browse.ts's module comment on browsePage's `screenshot` option), so returning
 * the base64 PNG here would just be an unreadable wall of text this (reasoning) model can't use; the
 * bytes go straight from the sandbox into the artifact write and are never echoed into the model's
 * context.
 */
export default defineTool({
  description: "Capture a screenshot of the product's homepage (or another key marketing page) and save it as a brand_screenshot artifact for future ad-creative reference. Call this at most once or twice per run — each call spins up a sandbox VM. You will not see the image itself (only its URL/title/byte size); that is expected.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1).optional(),
    url: z.string().url().describe("Absolute http(s) URL of the page to screenshot — usually the homepage."),
  }),
  async execute(input) {
    const page = await browsePage({ url: input.url, screenshot: true });
    if (page.screenshotBase64 == null) {
      throw new Error("Browser sandbox did not return a screenshot.");
    }
    const result = await saveArtifact({
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
      kind: "brand_screenshot",
      title: `Homepage screenshot: ${page.title || page.finalUrl}`,
      content: page.screenshotBase64,
      metadata: {
        source_url: input.url,
        final_url: page.finalUrl,
        page_title: page.title,
        mime_type: "image/png",
        byte_length_base64: page.screenshotBase64.length,
      },
    });
    return {
      artifact: result,
      final_url: page.finalUrl,
      page_title: page.title,
    };
  },
});
