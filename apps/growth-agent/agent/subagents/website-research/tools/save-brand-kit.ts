import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveArtifact } from "#lib/hexclave-client.ts";

/**
 * Persists the visual/verbal brand facts this subagent extracted from the live site, for later reuse
 * by ad creative generation (via brand_kit fields passed inline in a task message or delegation prompt —
 * this artifact itself is not re-read by any agent tool today; it exists for the dashboard and for
 * provenance via `brand_kit_ref` on a generated creative). The artifact kind is pinned to "brand_kit"
 * for the same reason save-crawl-summary.ts pins "crawl_summary": one fixed kind keeps the dashboard's
 * rendering predictable.
 */
export default defineTool({
  description: "Save the product's brand kit (palette, typography, tone, product category, imagery style, logo URL) as an artifact, once you've gathered enough of the site to describe it confidently. Call this after (or alongside) capture-homepage-screenshot. Skip any field you genuinely could not determine from the site rather than guessing.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1).optional(),
    palette: z.array(z.string().min(1)).max(8).optional().describe("Hex codes or named colors actually seen on the site, most prominent first."),
    typography: z.string().min(1).max(300).optional().describe("e.g. \"bold geometric sans for headings, plain sans for body\"."),
    tone: z.string().min(1).max(300).optional().describe("e.g. \"confident, technical, no-nonsense\"."),
    product_category: z.string().min(1).max(200).optional(),
    imagery_style: z.string().min(1).max(300).optional().describe("e.g. \"clean product screenshots on a solid background, no stock photos of people\"."),
    logo_url: z.string().url().optional(),
  }),
  async execute(input) {
    const fields: [string, string | undefined][] = [
      ["Product category", input.product_category],
      ["Tone", input.tone],
      ["Typography", input.typography],
      ["Imagery style", input.imagery_style],
      ["Palette", input.palette == null ? undefined : input.palette.join(", ")],
      ["Logo URL", input.logo_url],
    ];
    const content = [
      "# Brand kit",
      "",
      ...fields
        .filter(([, value]) => value != null)
        .map(([label, value]) => `- **${label}**: ${value}`),
    ].join("\n");

    const payload = {
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
      kind: "brand_kit",
      title: "Brand kit",
      content,
      metadata: {
        palette: input.palette ?? [],
        typography: input.typography ?? null,
        tone: input.tone ?? null,
        product_category: input.product_category ?? null,
        imagery_style: input.imagery_style ?? null,
        logo_url: input.logo_url ?? null,
      },
    };
    return await saveArtifact(payload);
  },
});
