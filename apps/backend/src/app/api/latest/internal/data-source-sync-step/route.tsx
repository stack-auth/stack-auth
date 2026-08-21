import { runDueDataSourceSyncs } from "@/lib/data-sources";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Snapshots of large tables are the slow case here, so this takes the full
// function budget rather than the default.
export const maxDuration = 300;

const FUNCTION_BUDGET_MS = maxDuration * 1000;
const FUNCTION_SHUTDOWN_SLACK_MS = 20 * 1000;
const HARD_DEADLINE_MS = FUNCTION_BUDGET_MS - FUNCTION_SHUTDOWN_SLACK_MS;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Sync due data sources",
    description: "Internal endpoint invoked by Vercel Cron. Syncs every data source whose interval has elapsed, until the queue drains or the function's time budget runs out.",
    tags: ["Data Warehouse"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
    query: yupObject({
      max_duration_ms: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ ok: yupBoolean().defined() }).defined(),
  }),
  handler: async ({ headers, query }) => {
    if (headers.authorization[0] !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }
    const requested = query.max_duration_ms != null ? Number(query.max_duration_ms) : HARD_DEADLINE_MS;
    if (!Number.isFinite(requested) || requested < 0) {
      throw new StatusError(400, "Invalid max_duration_ms");
    }
    const deadlineMs = Date.now() + Math.min(requested, HARD_DEADLINE_MS);

    while (Date.now() < deadlineMs) {
      const { didWork } = await runDueDataSourceSyncs({ deadlineMs });
      if (!didWork) break;
    }
    return { statusCode: 200, bodyType: "json", body: { ok: true } };
  },
});
