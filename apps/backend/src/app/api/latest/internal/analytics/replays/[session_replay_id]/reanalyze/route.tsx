import { analyzeReplayForTenancy } from "@/lib/replay-ai";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/vercel";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_replay_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["queued"]).defined(),
    }).defined(),
  }),
  async handler({ auth, params }) {
    runAsynchronouslyAndWaitUntil(analyzeReplayForTenancy({
      tenancy: auth.tenancy,
      sessionReplayId: params.session_replay_id,
    }));
    return {
      statusCode: 200,
      bodyType: "json",
      body: { status: "queued" },
    };
  },
});
