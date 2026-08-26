import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { verifyProjectOAuthAccessToken } from "@/lib/project-oauth-provider";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { KnownErrors } from "@hexclave/shared";
import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const INTERNAL_MCP_OAUTH_RESOURCE_IDS = new Set(["mcp", "mcpInternal"]);

export async function authenticateMcpOAuthUser(authorizationHeader: string | undefined): Promise<UsersCrud["Admin"]["Read"]> {
  const match = authorizationHeader === undefined ? null : /^Bearer (.+)$/i.exec(authorizationHeader);
  if (match === null) {
    throw new StatusError(StatusError.Unauthorized, "This endpoint requires an MCP OAuth access token in the Authorization header.");
  }
  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const verified = await verifyProjectOAuthAccessToken(internalTenancy, match[1], {
    allowedResourceIds: INTERNAL_MCP_OAUTH_RESOURCE_IDS,
  });
  if (verified === null) {
    throw new StatusError(StatusError.Unauthorized, "The MCP OAuth access token is invalid or expired. Re-authenticate with the MCP server.");
  }
  try {
    return await usersCrudHandlers.adminRead({
      tenancy: internalTenancy,
      user_id: verified.userId,
      allowedErrorTypes: [KnownErrors.UserNotFound],
    });
  } catch (error) {
    if (error instanceof KnownErrors.UserNotFound) {
      throw new StatusError(StatusError.Unauthorized, "The MCP OAuth access token is invalid or expired. Re-authenticate with the MCP server.");
    }
    throw error;
  }
}

export async function ensureUserManagesProject(user: UsersCrud["Admin"]["Read"], projectId: string): Promise<void> {
  const managedProjectIds = await listManagedProjectIds(user);
  if (!managedProjectIds.includes(projectId)) {
    throw new StatusError(StatusError.Forbidden, "You do not have access to this project. Check the project ID (visible in the dashboard URL).");
  }
}
