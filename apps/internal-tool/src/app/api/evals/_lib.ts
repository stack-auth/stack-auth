import { NextResponse } from "next/server";
import { checkEvalAccess } from "@/lib/evals/config";
import { describeError } from "@/lib/evals/types";

export function guard(request: Request): NextResponse | null {
  const access = checkEvalAccess(request);
  if (!access.ok) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }
  return null;
}

export function errorResponse(error: unknown, status: number = 500): NextResponse {
  return NextResponse.json({ error: describeError(error) }, { status });
}
