import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { createGrowthNotes } from "@/lib/growth/agent-writes";
import { GROWTH_CATEGORIES } from "@/lib/growth/categories";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { jsonSchema, yupArray, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

/**
 * Notes are the trend/pattern lane of the growth workspace, distinct from findings: a finding is a
 * point-in-time insight, a note is "this metric has been moving this way for N weeks". Deliberately
 * its own route rather than a `kind` the agent passes to /findings — the kind is what the overview's
 * lane split keys on, so leaving it agent-chosen would make a typo silently drop a note into the
 * findings lane with no error anywhere.
 */
export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      run_id: yupString().uuid().optional(),
      source: yupString().defined(),
      notes: yupArray(yupObject({
        category: yupString().oneOf([...GROWTH_CATEGORIES]).defined(),
        tags: yupArray(yupString().defined()).max(10).default([]),
        title: yupString().max(500).defined(),
        body: yupString().defined(),
        data: jsonSchema.optional(),
        document: jsonSchema.optional(),
      }).defined()).min(1).max(20).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const result = await createGrowthNotes({
      tenancy,
      runId: body.run_id,
      source: body.source,
      notes: body.notes.map((note) => ({
        category: note.category,
        tags: note.tags,
        title: note.title,
        body: note.body,
        data: note.data,
        document: note.document,
      })),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { created_count: result.createdCount, skipped_count: result.skippedCount },
    };
  },
});
