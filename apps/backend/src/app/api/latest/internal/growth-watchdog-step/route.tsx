import { runGrowthWatchdogSweep } from "@/lib/growth/watchdog";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { wait } from "@hexclave/shared/dist/utils/promises";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// The watchdog only does quick DB scans plus the occasional workflow seed
// (compile + manifest sandbox, bounded per call), so the default function
// budget with a small shutdown slack is enough.
export const maxDuration = 300;

const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
const FUNCTION_BUDGET_MS = maxDuration * 1000;
const FUNCTION_SHUTDOWN_SLACK_MS = 20 * 1000;
const HARD_DEADLINE_MS = FUNCTION_BUDGET_MS - FUNCTION_SHUTDOWN_SLACK_MS;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Process growth watchdog step",
    description: "Internal endpoint invoked by Vercel Cron to run the growth watchdog sweep (workflow seeding, orphaned-run resurrection, missed-brief catch-up, stale-brief cleanup).",
    tags: ["Growth"],
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
      const { didWork } = await runGrowthWatchdogSweep({ deadlineMs });
      if (query.only_one_step === "true") break;
      if (performance.now() - startTime >= maxDurationMs) break;
      // An idle sweep ENDS the invocation rather than sleeping until the next one: the watchdog is a
      // repair loop, not the progress driver (the workflow engine is), so its idle cadence belongs to
      // the cron schedule in vercel.json. Sleeping for that cadence here cannot work — any wait long
      // enough to be a genuinely low frequency outlives the function budget, so the invocation would
      // be killed mid-sleep having done exactly the one sweep it already did, and we would pay for
      // the idle time. Returning early also keeps invocations short enough that the every-N-minutes
      // schedule never overlaps itself.
      //
      // Tolerance check for whoever tunes that schedule: nothing here needs fine granularity. A run
      // is only considered orphaned after GROWTH_WATCHDOG_RUN_GRACE_MS (5min), and its resurrection
      // event is bucketed to GROWTH_WATCHDOG_EVENT_BUCKET_MS (10min), so sweeping more often than
      // every 10 minutes cannot re-fire a repair any sooner. Brief catch-up is once-daily and the
      // stale-brief threshold is 3 hours.
      if (!didWork) break;
      // A sweep that DID repair something keeps going on a short delay, because repairs cascade: a
      // reseeded workflow definition is what lets the next sweep resurrect the run whose leg was
      // missing. Draining that chain now is far cheaper than one cron interval per link.
      await wait(5_000);
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
