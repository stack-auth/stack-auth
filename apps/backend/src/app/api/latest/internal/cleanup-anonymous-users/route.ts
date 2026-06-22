import { runCleanupAnonymousUsersStep } from "@/lib/cleanup-anonymous-users";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Clean up stale guest accounts",
    description: "Internal endpoint invoked by Vercel Cron to delete anonymous (guest) accounts that have been inactive longer than each project's configured TTL.",
    tags: ["Anonymous"],
    hidden: true,
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
      ok: yupBoolean().defined(),
      deleted: yupNumber().defined(),
      tenancies_processed: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const { deleted, tenanciesProcessed } = await runCleanupAnonymousUsersStep();

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
        deleted,
        tenancies_processed: tenanciesProcessed,
      },
    };
  },
});
