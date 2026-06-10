import { NextResponse } from "next/server";
import { computeOpenRouterCostUsd } from "@/lib/evals/openrouter";
import { listRuns, listStepRuns, upsertEvalStepRun } from "@/lib/evals/stdb";
import { errorResponse, guard } from "../../_lib";

export const runtime = "nodejs";

/**
 * Backfill: reprice every stored step run from its token counts and the
 * model's OpenRouter rates. Historical rows stored Claude Code's self-reported
 * total_cost_usd, which was priced against Anthropic's built-in table instead
 * of the OpenRouter model actually used. Idempotent — steps without token
 * usage or without listed pricing are left untouched.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    let repriced = 0;
    let skipped = 0;
    for (const run of await listRuns()) {
      for (const step of await listStepRuns(run.runId)) {
        const costUsd = await computeOpenRouterCostUsd(step.model, step);
        if (costUsd === undefined || costUsd === step.costUsd) {
          skipped += 1;
          continue;
        }
        await upsertEvalStepRun({
          stepRunId: step.stepRunId,
          runId: step.runId,
          stepIndex: step.stepIndex,
          stepName: step.stepName,
          model: step.model,
          status: step.status,
          resultText: step.resultText,
          error: step.error,
          numMessages: step.numMessages,
          costUsd,
          inputTokens: step.inputTokens,
          outputTokens: step.outputTokens,
          cacheReadTokens: step.cacheReadTokens,
          cacheCreationTokens: step.cacheCreationTokens,
          sessionId: step.sessionId,
        });
        repriced += 1;
      }
    }
    return NextResponse.json({ ok: true, repriced, skipped });
  } catch (error) {
    return errorResponse(error);
  }
}
