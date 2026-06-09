import { NextResponse } from "next/server";
import { checkEvalAccess } from "@/lib/evals/config";

export function guard(request: Request): NextResponse | null {
  const access = checkEvalAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }
  return null;
}

export function errorResponse(error: unknown, status: number = 500): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
