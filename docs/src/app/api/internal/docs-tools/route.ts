import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type DocsToolAction, executeDocsToolAction } from "@/lib/docs-tools-operations";

const bodySchema: z.ZodType<DocsToolAction> = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_available_docs") }),
  z.object({
    action: z.literal("search_docs"),
    search_query: z.string(),
    result_limit: z.number().optional(),
  }),
  z.object({ action: z.literal("get_docs_by_id"), id: z.string() }),
  z.object({ action: z.literal("get_stack_auth_setup_instructions") }),
  z.object({ action: z.literal("search"), query: z.string() }),
  z.object({ action: z.literal("fetch"), id: z.string() }),
]);

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await executeDocsToolAction(parsed.data);
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json(
    { error: "Use POST with a DocsToolAction body" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
