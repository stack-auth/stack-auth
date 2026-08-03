import { runBrainEngineStep } from "@/lib/brain";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const DEFAULT_MAX_DURATION_MS = 2 * 60 * 1000;
const FUNCTION_BUDGET_MS = maxDuration * 1000;
const FUNCTION_SHUTDOWN_SLACK_MS = 20 * 1000;
const HARD_DEADLINE_MS = FUNCTION_BUDGET_MS - 180_000 - FUNCTION_SHUTDOWN_SLACK_MS;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Process Brain engine step",
    description: "Internal endpoint invoked by Vercel Cron to wake Brains with pending queue work.",
    tags: ["Brain"],
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
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const requestedMaxDurationMs = query.max_duration_ms != null ? Number(query.max_duration_ms) : DEFAULT_MAX_DURATION_MS;
    if (!Number.isFinite(requestedMaxDurationMs) || requestedMaxDurationMs < 0) {
      throw new StatusError(400, "Invalid max_duration_ms");
    }
    const maxDurationMs = Math.min(requestedMaxDurationMs, HARD_DEADLINE_MS);
    const startTime = performance.now();
    const deadlineMs = Date.now() + maxDurationMs;

    while (true) {
      const { didWork } = await runBrainEngineStep({ deadlineMs });
      if (query.only_one_step === "true") break;
      if (performance.now() - startTime >= maxDurationMs) break;
      await wait(didWork ? 200 : 2000);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
      },
    };
  },
});
