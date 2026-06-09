import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureDefaultWorkflow } from "@/lib/evals/default-workflow";
import { listWorkflows, upsertEvalWorkflow } from "@/lib/evals/stdb";
import { parseSteps } from "@/lib/evals/types";
import { errorResponse, guard } from "../_lib";

export const runtime = "nodejs";

// Listing also seeds the built-in default workflow on first use; the UI calls
// this once on mount and otherwise reads workflows live from SpacetimeDB.
export async function GET(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    await ensureDefaultWorkflow();
    const workflows = await listWorkflows();
    return NextResponse.json({
      workflows: workflows.map(w => ({
        workflowId: w.workflowId,
        name: w.name,
        description: w.description,
        defaultModel: w.defaultModel,
        stepsJson: w.stepsJson,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const body = await request.json() as {
      workflowId?: string,
      name?: string,
      description?: string,
      stepsJson?: string,
      defaultModel?: string,
    };
    if (!body.name || !body.stepsJson || !body.defaultModel) {
      return errorResponse(new Error("name, stepsJson and defaultModel are required"), 400);
    }
    parseSteps(body.stepsJson); // validate
    const workflowId = body.workflowId ?? randomUUID();
    await upsertEvalWorkflow({
      workflowId,
      name: body.name,
      description: body.description ?? "",
      stepsJson: body.stepsJson,
      defaultModel: body.defaultModel,
    });
    return NextResponse.json({ workflowId });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
