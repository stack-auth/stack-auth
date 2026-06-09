import { NextResponse } from "next/server";
import { execInRun } from "@/lib/evals/orchestrator";
import { errorResponse, guard } from "../../../_lib";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { runId } = await context.params;
    const body = await request.json() as { command?: string };
    if (!body.command || body.command.trim() === "") {
      return errorResponse(new Error("command is required"), 400);
    }
    const result = await execInRun(runId, body.command);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
