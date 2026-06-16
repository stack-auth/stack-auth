import { NextResponse } from "next/server";
import { cancelEvalRun, resetStep, runStepFromIndex } from "@/lib/evals/orchestrator";
import { errorResponse, guard } from "../../../../_lib";

export const runtime = "nodejs";

// Per-step lifecycle controls for a run:
// - "continue"  re-run this step (and the rest) injecting the prior partial attempt
// - "restart"   re-run this step (and the rest) from scratch
// - "reset"     mark this step back to pending without executing
// - "stop"      abort the run while it is executing this step
type StepAction = "continue" | "restart" | "reset" | "stop";

function parseAction(value: unknown): StepAction {
  if (value === "continue" || value === "restart" || value === "reset" || value === "stop") return value;
  throw new Error("action must be 'continue', 'restart', 'reset', or 'stop'");
}

export async function POST(request: Request, context: { params: Promise<{ runId: string, stepIndex: string }> }): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { runId, stepIndex: stepIndexRaw } = await context.params;
    const stepIndex = Number.parseInt(stepIndexRaw, 10);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      throw new Error(`Invalid step index: ${stepIndexRaw}`);
    }
    const body = await request.json().catch(() => ({})) as { action?: unknown };
    const action = parseAction(body.action);
    switch (action) {
      case "stop": {
        await cancelEvalRun(runId);
        break;
      }
      case "reset": {
        await resetStep(runId, stepIndex);
        break;
      }
      case "continue": {
        await runStepFromIndex(runId, stepIndex, "continue");
        break;
      }
      case "restart": {
        await runStepFromIndex(runId, stepIndex, "restart-step");
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
