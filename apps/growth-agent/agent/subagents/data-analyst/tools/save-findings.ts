import { defineTool } from "eve/tools";
import { z } from "zod";
import { jsonObjectSchema } from "#lib/json-payload.ts";
import { growthCategorySchema, growthTagsSchema } from "#lib/growth-taxonomy.ts";
import { GROWTH_DOCUMENT_AUTHORING_GUIDE, growthDocumentInputSchema } from "#lib/growth-document.ts";
import { saveFindings } from "#lib/hexclave-client.ts";

// Thin per-subagent wrapper around the shared backend client. The `source` is
// pinned to this subagent's identity and the finding kinds are restricted to
// the ones this analyst produces, so a confused model cannot write findings
// under another phase's identity.
export default defineTool({
  description: `Save data-analysis findings to the Hexclave backend for the current growth run. Every finding must cite concrete numbers from queries run in this session. ${GROWTH_DOCUMENT_AUTHORING_GUIDE} Use the exact project_id, branch_id, and run_id you were given in your task message.`,
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    run_id: z.string().min(1).optional(),
    findings: z.array(z.object({
      kind: z.enum(["data-insight", "metric-baseline"]),
      category: growthCategorySchema,
      tags: growthTagsSchema,
      title: z.string().min(1).max(500),
      body: z.string().min(1),
      document: growthDocumentInputSchema,
      data: jsonObjectSchema.optional(),
    })).min(1).max(20),
  }),
  async execute(input) {
    // The backend findings route additionally requires project_id/branch_id in
    // the body (they scope the machine-secret auth to a tenancy). The shared
    // client's saveFindings input type does not list them yet (6B tightens it
    // against the route schemas), so we pass a wider object: width subtyping
    // accepts it and JSON.stringify serializes every field onto the wire.
    const payload = {
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
      // The backend validates `source` against the PHASE KEYS (plus a few fixed non-phase
      // surfaces), not against subagent names, and rejects anything else with a 400. This
      // subagent is called `data-analyst` but the phase it runs inside is `data-analysis`, so
      // sending the subagent's own name silently lost every finding it produced: the tool call
      // failed, the model moved on, and the phase still reported COMPLETED with nothing saved.
      // The website-research subagent gets away with its own name only because that name happens
      // to equal its phase key.
      source: "data-analysis",
      findings: input.findings.map((finding) => ({ ...finding, tags: finding.tags ?? [] })),
    };
    return await saveFindings(payload);
  },
});
