import { NextResponse } from "next/server";
import { startEvalBatch } from "@/lib/evals/orchestrator";
import { errorResponse, guard } from "../_lib";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const body = await request.json() as {
      workflowId?: string,
      models?: string[],
      runsPerModel?: number,
      timeoutMinutes?: number,
      variables?: Record<string, string>,
      labelPrefix?: string,
    };
    if (!body.workflowId || !Array.isArray(body.models) || body.models.length === 0) {
      return errorResponse(new Error("workflowId and a non-empty models array are required"), 400);
    }
    const runIds = await startEvalBatch({
      workflowId: body.workflowId,
      models: body.models,
      runsPerModel: body.runsPerModel,
      timeoutMinutes: body.timeoutMinutes,
      variables: body.variables,
      labelPrefix: body.labelPrefix,
    });
    return NextResponse.json({ runIds });
  } catch (error) {
    return errorResponse(error);
  }
}
