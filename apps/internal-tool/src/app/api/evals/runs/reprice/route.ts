import { NextResponse } from "next/server";
import { computeOpenRouterCostUsd } from "@/lib/evals/openrouter";
import { listRuns, listStepRuns, listWorklog, upsertEvalStepRun } from "@/lib/evals/stdb";
import { StreamUsageAccumulator } from "@/lib/evals/usage";
import { errorResponse, guard } from "../../_lib";

export const runtime = "nodejs";

function maxBig(a: bigint, b: bigint | undefined): bigint {
  return b !== undefined && b > a ? b : a;
}

/**
 * Backfill: rebuild every step run's token usage from its stored worklog
 * (summing usage across all API calls, deduped per call) and reprice it at
 * the model's OpenRouter rates. Historical rows are doubly wrong: they stored
 * Claude Code's self-reported cost (priced against the Anthropic table) AND
 * usage figures that covered only the final API call of each step. Idempotent;
 * steps with no recorded usage anywhere are left untouched.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    let repriced = 0;
    let skipped = 0;
    let totalUsd = 0;
    const steps: { runId: string, stepName: string, model: string, costUsd: string | undefined }[] = [];
    for (const run of await listRuns()) {
      for (const step of await listStepRuns(run.runId)) {
        const usage = new StreamUsageAccumulator();
        for (const entry of await listWorklog(step.stepRunId)) {
          usage.addLine(entry.content);
        }
        const totals = usage.totals();
        // Stored figures act as a floor in case a worklog is incomplete.
        const merged = {
          inputTokens: maxBig(totals.inputTokens, step.inputTokens),
          outputTokens: maxBig(totals.outputTokens, step.outputTokens),
          cacheReadTokens: maxBig(totals.cacheReadTokens, step.cacheReadTokens),
          cacheCreationTokens: maxBig(totals.cacheCreationTokens, step.cacheCreationTokens),
        };
        const costUsd = await computeOpenRouterCostUsd(step.model, merged) ?? step.costUsd;
        if (costUsd !== undefined) totalUsd += Number.parseFloat(costUsd);
        steps.push({ runId: step.runId, stepName: step.stepName, model: step.model, costUsd });
        const unchanged = costUsd === step.costUsd
          && merged.inputTokens === (step.inputTokens ?? 0n)
          && merged.outputTokens === (step.outputTokens ?? 0n)
          && merged.cacheReadTokens === (step.cacheReadTokens ?? 0n)
          && merged.cacheCreationTokens === (step.cacheCreationTokens ?? 0n);
        if (unchanged) {
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
          inputTokens: merged.inputTokens,
          outputTokens: merged.outputTokens,
          cacheReadTokens: merged.cacheReadTokens,
          cacheCreationTokens: merged.cacheCreationTokens,
          sessionId: step.sessionId,
        });
        repriced += 1;
      }
    }
    return NextResponse.json({ ok: true, repriced, skipped, totalUsd: totalUsd.toFixed(4), steps });
  } catch (error) {
    return errorResponse(error);
  }
}
