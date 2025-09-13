import { getTenancy } from "@/lib/tenancies";
import { ensureUpstashSignature } from "@/lib/upstash";
import { triggerScheduledWorkflows } from "@/lib/workflows";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "upstash-signature": yupTuple([yupString().defined()]).defined(),
    }).defined(),
    body: yupObject({
      tenancyId: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req, fullReq) => {
    await ensureUpstashSignature(fullReq);

    const tenancy = await getTenancy(req.body.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError(`Tenancy not found for scheduled trigger`, { tenancyId: req.body.tenancyId });
    }

    await triggerScheduledWorkflows(tenancy);

    return {
      statusCode: 200,
      bodyType: "success",
    } as const;
  },
});

