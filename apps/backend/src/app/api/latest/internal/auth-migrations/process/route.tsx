import { runAuthMigrationQueueStep } from "@/lib/auth-migrations/jobs";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Process auth migration queue step",
    description: "Internal endpoint invoked by cron to advance auth provider migration jobs.",
    tags: ["Migrations"],
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      claimed: yupNumber().integer().defined(),
      reset_stuck: yupNumber().integer().defined(),
    }).defined(),
  }),
  handler: async ({ headers }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const result = await runAuthMigrationQueueStep();
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        claimed: result.claimed,
        reset_stuck: result.resetStuck,
      },
    };
  },
});
