import { handleProjectOAuthRequest } from "@/lib/project-oauth-route";
import { handleApiRequest } from "@/route-handlers/smart-route-handler";

export const dynamic = "force-dynamic";

export const GET = handleApiRequest(handleProjectOAuthRequest);
