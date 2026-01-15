import { checkApiKeySet } from "@/lib/internal-api-keys";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { decodeAccessToken } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "../../users/crud";

/**
 * The team ID for Stack Auth support team members.
 *
 * This team should be created in the "internal" project and only
 * Stack Auth team members who need support access should be added.
 *
 * Can be configured via STACK_INTERNAL_SUPPORT_TEAM_ID environment variable,
 * defaults to 'stack-auth-support'.
 */
const SUPPORT_TEAM_ID = getEnvVariable("STACK_INTERNAL_SUPPORT_TEAM_ID", "stack-auth-support");

type SupportAuthResult =
  | { success: true, userId: string, userEmail: string | null, teamId: string }
  | { success: false, response: NextResponse };

/**
 * Validates that the request is from an authenticated Stack Auth support team member.
 *
 * Authorization is based on **team membership**, not email domain. This ensures:
 * 1. Proper access control using Stack Auth's own authorization model
 * 2. Easy management through the dashboard (add/remove team members)
 * 3. Auditable access via team membership history
 *
 * Requirements:
 * 1. Valid access token for the "internal" project
 * 2. Valid publishable client key for the "internal" project
 * 3. User must be a member of the support team (STACK_INTERNAL_SUPPORT_TEAM_ID)
 */
export async function validateSupportAuth(request: NextRequest): Promise<SupportAuthResult> {
  const projectId = request.headers.get("x-stack-project-id");
  const accessToken = request.headers.get("x-stack-access-token");
  const publishableClientKey = request.headers.get("x-stack-publishable-client-key");

  // Must be requesting the internal project
  if (projectId !== "internal") {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Support API requires internal project authentication" },
        { status: 401 }
      ),
    };
  }

  // Validate publishable client key
  if (!publishableClientKey) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Missing publishable client key" },
        { status: 401 }
      ),
    };
  }

  const isKeyValid = await checkApiKeySet("internal", { publishableClientKey });
  if (!isKeyValid) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Invalid publishable client key" },
        { status: 401 }
      ),
    };
  }

  // Validate access token
  if (!accessToken) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Missing access token" },
        { status: 401 }
      ),
    };
  }

  const tokenResult = await decodeAccessToken(accessToken, {
    allowAnonymous: false,
    allowRestricted: false,
  });

  if (tokenResult.status === "error") {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Invalid or expired access token" },
        { status: 401 }
      ),
    };
  }

  if (tokenResult.data.projectId !== "internal") {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Access token is not for the internal project" },
        { status: 401 }
      ),
    };
  }

  // Fetch the user
  const user = await getUser({
    projectId: "internal",
    branchId: DEFAULT_BRANCH_ID,
    userId: tokenResult.data.userId,
  });

  if (!user) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      ),
    };
  }

  // Check team membership - this is the PROPER authorization check
  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

  // Get user's teams for logging (not exposed to client)
  const userTeams = await internalPrisma.teamMember.findMany({
    where: {
      tenancyId: internalTenancy.id,
      projectUserId: user.id,
    },
    include: {
      team: true,
    },
  });

  const supportTeamMembership = await internalPrisma.teamMember.findFirst({
    where: {
      tenancyId: internalTenancy.id,
      projectUserId: user.id,
      team: {
        teamId: SUPPORT_TEAM_ID,
      },
    },
    include: {
      team: true,
    },
  });

  if (!supportTeamMembership) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      ),
    };
  }

  return {
    success: true,
    userId: user.id,
    userEmail: user.primary_email,
    teamId: SUPPORT_TEAM_ID,
  };
}
