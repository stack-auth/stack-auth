import { runWorkflowEngineStep, WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS } from "@/lib/workflows/engine";
import { getRequestContext } from "@/lib/runtime/request-context";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
// Keep this operational loop budget aligned with the literal Vercel entrypoint
// limit in src/index.ts. The entrypoint cannot import a shared value because
// Vercel's builder statically requires a numeric literal in the config object.
const FUNCTION_BUDGET_MS = 800 * 1000;
const FUNCTION_SHUTDOWN_SLACK_MS = 20 * 1000;
// This is a latest-start budget, not a latest-finish budget. A workflow
// invocation started at the boundary may consume the full 10-minute step
// timeout plus its engine backstop, so reserve that time inside Vercel's
// function duration.
const HARD_DEADLINE_MS = FUNCTION_BUDGET_MS - WORKFLOW_INVOCATION_BACKSTOP_TIMEOUT_MS - FUNCTION_SHUTDOWN_SLACK_MS;

async function waitForNextStep(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

import.meta.vitest?.test("workflow polling delay observes client cancellation", async ({ expect }) => {
  const controller = new AbortController();
  const cancellation = new Error("client disconnected");
  controller.abort(cancellation);

  await expect(waitForNextStep(2000, controller.signal)).rejects.toBe(cancellation);
});

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
    const signal = getRequestContext().abortSignal;

    while (true) {
      signal.throwIfAborted();
      const { didWork } = await runWorkflowEngineStep({ deadlineMs });
      signal.throwIfAborted();
      if (query.only_one_step === "true") break;
      if (performance.now() - startTime >= maxDurationMs) break;
      // Idle-wait longer when nothing happened; overlapping ticks (cron
      // fires every minute) keep latency at ~1min worst case anyway, which
      // is the documented precision contract.
      await waitForNextStep(didWork ? 200 : 2000, signal);
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
