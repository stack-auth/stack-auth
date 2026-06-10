import { handleMcpToolOptions, handleMcpToolRoute } from "@/mcp-wrapper";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return await handleMcpToolRoute(req);
}

export async function HEAD(req: Request) {
  return await handleMcpToolRoute(req);
}

export function OPTIONS() {
  return handleMcpToolOptions();
}
