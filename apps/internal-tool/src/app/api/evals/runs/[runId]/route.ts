import { NextResponse } from "next/server";
import { cancelEvalRun } from "@/lib/evals/orchestrator";
import { deleteEvalRun, getRun } from "@/lib/evals/stdb";
import { errorResponse, guard } from "../../_lib";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { runId } = await context.params;
    const run = await getRun(runId);
    if (run && ["queued", "booting", "running"].includes(run.status)) {
      await cancelEvalRun(runId);
    }
    await deleteEvalRun(runId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
