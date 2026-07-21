import { runWorkflowEngineStep } from "@/lib/workflows/engine";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// Unlike the other cron routes, the workflow tick awaits sandbox invocations
// whose per-step timeout can reach 10 minutes, so it needs Vercel's larger
// function budget (the in-code loop still stops early enough to fit).
export const maxDuration = 800;

const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
// Stop starting new work well before maxDuration so an in-flight invocation
// (up to 10min step cap + slack) can still finish inside the function budget
// in the worst case. Ticks fire every minute, so leftover work never waits
// long.
const HARD_DEADLINE_MS = 780 * 1000;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Process workflow engine step",
    description: "Internal endpoint invoked by Vercel Cron to advance the workflow engine (event dispatch, run execution, schedules).",
    tags: ["Workflows"],
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
      const { didWork } = await runWorkflowEngineStep({ deadlineMs });
      if (query.only_one_step === "true") break;
      if (performance.now() - startTime >= maxDurationMs) break;
      // Idle-wait longer when nothing happened; overlapping ticks (cron
      // fires every minute) keep latency at ~1min worst case anyway, which
      // is the documented precision contract.
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
