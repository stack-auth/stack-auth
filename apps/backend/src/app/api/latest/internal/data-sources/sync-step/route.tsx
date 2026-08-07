import { runDataSourcesSyncStep } from "@/lib/data-sources/sync";
import { getRequestContext } from "@/lib/runtime/request-context";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Cron entry point for Data Sources, alongside the email-queue, external-db-sync
 * and workflow-engine steps in apps/backend/vercel.json.
 *
 * The loop keeps advancing runs while there is work and time, so a project with
 * several sources does not have to wait a full minute between slices. It stops
 * as soon as a pass finds nothing to do, which is the common case.
 */
const DEFAULT_MAX_DURATION_MS = 60 * 1000;
const HARD_DEADLINE_MS = 4 * 60 * 1000;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Advance data source syncs",
    description: "Internal endpoint invoked by Vercel Cron to advance in-flight data source imports by one bounded slice.",
    tags: ["DataSources"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
    query: yupObject({
      only_one_step: yupString().oneOf(["true", "false"]).optional(),
      max_duration_ms: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      steps: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const requestedMaxDurationMs = query.max_duration_ms != null
      ? Number(query.max_duration_ms)
      : DEFAULT_MAX_DURATION_MS;
    if (!Number.isFinite(requestedMaxDurationMs) || requestedMaxDurationMs < 0) {
      throw new StatusError(400, "Invalid max_duration_ms");
    }
    const maxDurationMs = Math.min(requestedMaxDurationMs, HARD_DEADLINE_MS);
    const startTime = performance.now();
    const signal = getRequestContext().abortSignal;

    let steps = 0;
    while (true) {
      signal.throwIfAborted();
      const { didWork } = await runDataSourcesSyncStep();
      steps += 1;
      if (!didWork) break;
      if (query.only_one_step === "true") break;
      if (performance.now() - startTime >= maxDurationMs) break;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { ok: true, steps },
    };
  },
});
