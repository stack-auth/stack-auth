import { NextResponse } from "next/server";
import { deleteEvalWorkflow } from "@/lib/evals/stdb";
import { errorResponse, guard } from "../../_lib";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ workflowId: string }> }): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const { workflowId } = await context.params;
    await deleteEvalWorkflow(workflowId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
