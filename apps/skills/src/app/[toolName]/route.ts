import { handleMcpToolHead, handleMcpToolOptions, handleMcpToolRoute } from "@/mcp-wrapper";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return await handleMcpToolRoute(req);
}

export function HEAD() {
  return handleMcpToolHead();
}

export function OPTIONS() {
  return handleMcpToolOptions();
}
