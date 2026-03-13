import { findSimilarReplaysForTenancy } from "@/lib/replay-ai";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_replay_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        session_replay_id: yupString().defined(),
        score: yupNumber().defined(),
        summary: yupString().nullable().defined(),
        severity: yupString().nullable().defined(),
        issue_title: yupString().nullable().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  async handler({ auth, params, query }) {
    const limit = query.limit ? Number(query.limit) : undefined;
    const items = await findSimilarReplaysForTenancy({
      tenancy: auth.tenancy,
      sessionReplayId: params.session_replay_id,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { items },
    };
  },
});
