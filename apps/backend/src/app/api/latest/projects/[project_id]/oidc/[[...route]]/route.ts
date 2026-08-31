import { handleProjectOAuthRequest } from "@/lib/project-oauth-route";
import { handleApiRequest } from "@/route-handlers/smart-route-handler";

export const dynamic = "force-dynamic";

const handler = handleApiRequest(handleProjectOAuthRequest);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
