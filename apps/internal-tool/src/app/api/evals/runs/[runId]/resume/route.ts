import { NextResponse } from "next/server";
import { resumeEvalRun, type ResumeRunMode } from "@/lib/evals/orchestrator";
import { errorResponse, guard } from "../../../_lib";

export const runtime = "nodejs";

function parseMode(value: unknown): ResumeRunMode {
  if (value === "continue" || value === "restart-step") return value;
  throw new Error("mode must be 'continue' or 'restart-step'");
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { runId } = await context.params;
    const body = await request.json().catch(() => ({})) as { mode?: unknown };
    await resumeEvalRun(runId, parseMode(body.mode));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
