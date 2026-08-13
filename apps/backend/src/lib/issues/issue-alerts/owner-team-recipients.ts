import { getBillingTeamId } from "@/lib/plan-entitlements";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";

export type MatchOwnerTeamRecipientsResult =
  | { status: "ok", emails: string[] }
  | { status: "missing_member", userId: string }
  | { status: "missing_email", userId: string };

/**
 * Dashboard collaborators live on the internal project's owner team, not as
 * users of the customer project. Issue-alert email therefore has to resolve
 * those IDs to primary emails and send through `sendEmail({ emails })`.
 */
export function matchOwnerTeamRecipients(
  requestedUserIds: readonly string[],
  emailsByUserId: ReadonlyMap<string, string | null>,
): MatchOwnerTeamRecipientsResult {
  const emails: string[] = [];
  for (const userId of requestedUserIds) {
    if (!emailsByUserId.has(userId)) {
      return { status: "missing_member", userId };
    }
    const email = emailsByUserId.get(userId);
    if (email == null || email === "") {
      return { status: "missing_email", userId };
    }
    emails.push(email);
  }
  return { status: "ok", emails };
}

export async function loadOwnerTeamMemberEmailsByUserId(tenancy: Tenancy): Promise<Map<string, string | null> | null> {
  const ownerTeamId = getBillingTeamId(tenancy.project);
  if (ownerTeamId == null) return null;

  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID, true);
  if (internalTenancy == null) return null;

  const prisma = await getPrismaClientForTenancy(internalTenancy);
  const members = await prisma.teamMember.findMany({
    where: {
      tenancyId: internalTenancy.id,
      teamId: ownerTeamId,
    },
    select: {
      projectUser: {
        select: {
          projectUserId: true,
          contactChannels: {
            where: { type: "EMAIL", isPrimary: "TRUE" },
            select: { value: true },
            take: 1,
          },
        },
      },
    },
  });

  return new Map(members.map((member) => [
    member.projectUser.projectUserId,
    member.projectUser.contactChannels[0]?.value ?? null,
  ]));
}

export async function resolveIssueAlertOwnerTeamEmails(
  tenancy: Tenancy,
  userIds: readonly string[],
): Promise<readonly string[] | undefined> {
  const emailsByUserId = await loadOwnerTeamMemberEmailsByUserId(tenancy);
  if (emailsByUserId == null) return undefined;
  const matched = matchOwnerTeamRecipients(userIds, emailsByUserId);
  return matched.status === "ok" ? matched.emails : undefined;
}
