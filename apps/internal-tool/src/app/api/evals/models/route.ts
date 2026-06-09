import { NextResponse } from "next/server";
import { searchOpenRouterModels } from "@/lib/evals/openrouter";
import { errorResponse, guard } from "../_lib";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "100") || 100, 400);
    const models = await searchOpenRouterModels(search, limit);
    return NextResponse.json({ models });
  } catch (error) {
    return errorResponse(error);
  }
}
