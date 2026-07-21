import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const DELETE = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      key: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    const result = await globalPrismaClient.workflowSecret.deleteMany({
      where: { tenancyId: tenancy.id, key: params.key },
    });
    if (result.count === 0) {
      throw new StatusError(404, "Secret not found");
    }
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
