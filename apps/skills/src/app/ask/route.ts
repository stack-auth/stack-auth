import { handleAskToolOptions, handleAskToolRoute } from "@/ask-route";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return await handleAskToolRoute(req);
}

export async function HEAD(req: Request) {
  return await handleAskToolRoute(req);
}

export function OPTIONS() {
  return handleAskToolOptions();
}
