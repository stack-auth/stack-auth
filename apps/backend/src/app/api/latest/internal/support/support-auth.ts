import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { KnownErrors } from "@stackframe/stack-shared";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { adaptSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * The team ID for Stack Auth support team members.
 *
 * This team should be created in the "internal" project and only
 * Stack Auth team members who need support access should be added.
 *
 * Can be configured via STACK_INTERNAL_SUPPORT_TEAM_ID environment variable.
 */
export const SUPPORT_TEAM_ID = getEnvVariable("STACK_INTERNAL_SUPPORT_TEAM_ID", "");

/**
 * Schema for support API authentication.
 *
 * Requires:
 * 1. Authentication with the "internal" project
 * 2. A valid user session
 *
 * Note: Team membership is validated separately in `validateSupportTeamMembership`
 */
export const supportAuthSchema = yupObject({
  type: adaptSchema.defined(),
  user: adaptSchema.defined(),
  tenancy: adaptSchema.defined(),
  project: yupObject({
    id: yupString().oneOf(["internal"]).defined(),
  }).defined(),
}).defined();

export type SupportAuth = {
  user: UsersCrud["Admin"]["Read"],
  tenancy: Tenancy,
};

/**
 * Validates that the authenticated user is a member of the support team.
 *
 * This should be called at the start of every support API handler after
 * schema validation to ensure proper authorization.
 *
 * @throws StatusError 403 if user is not a support team member
 */
export async function validateSupportTeamMembership(auth: SmartRequestAuth): Promise<SupportAuth> {
  if (!auth.user) {
    throw new KnownErrors.UserAuthenticationRequired();
  }

  if (!SUPPORT_TEAM_ID) {
    throw new StatusError(403, "Support API is not configured. STACK_INTERNAL_SUPPORT_TEAM_ID is not set.");
  }

  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

  const supportTeamMembership = await internalPrisma.teamMember.findFirst({
    where: {
      tenancyId: internalTenancy.id,
      projectUserId: auth.user.id,
      team: {
        teamId: SUPPORT_TEAM_ID,
      },
    },
  });

  if (!supportTeamMembership) {
    throw new StatusError(403, "Access denied. User is not a member of the support team.");
  }

  return {
    user: auth.user,
    tenancy: auth.tenancy,
  };
}
