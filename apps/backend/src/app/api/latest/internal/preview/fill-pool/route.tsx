import { cleanupExpiredPreviewPoolLeases, fillPreviewPool } from "@/lib/preview-pool";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Fill preview dashboard lease pool",
    description: "Creates pre-seeded isolated dashboard preview projects until the preview pool reaches its configured ready size. Only available in preview mode.",
    tags: ["Internal"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    headers: yupObject({
      authorization: yupTuple([yupString().defined()]).optional(),
    }).defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ready_count_before: yupNumber().defined(),
      created_count: yupNumber().defined(),
      target_ready_count: yupNumber().defined(),
      deleted_expired_count: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, headers }) {
    const isInternalAdmin = auth?.type === "admin" && auth.project.id === "internal";
    const authHeader = headers.authorization?.[0];
    if (!isInternalAdmin && authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const cleanupResult = await cleanupExpiredPreviewPoolLeases();
    const result = await fillPreviewPool({ maxCreate: 1 });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ready_count_before: result.readyCountBefore,
        created_count: result.createdCount,
        target_ready_count: result.targetReadyCount,
        deleted_expired_count: cleanupResult.deletedCount,
      },
    };
  },
});
