import { teamMembershipsCrudHandlers } from "@/app/api/latest/team-memberships/crud";
import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import type { Tenancy } from "@/lib/tenancies";
import type { StackMigrationPlan } from "./types";

export type StackImportResult = {
  userIdMap: Record<string, string>,
  teamIdMap: Record<string, string>,
  importedUsers: number,
  importedTeams: number,
  importedMemberships: number,
};

export async function importPlanToStackAuth(tenancy: Tenancy, plan: StackMigrationPlan): Promise<StackImportResult> {
  const userIdMap = new Map<string, string>();
  for (const user of plan.users) {
    const created = await usersCrudHandlers.serverCreate({
      tenancy,
      data: user.body,
    });
    userIdMap.set(user.externalUserId, created.id);
  }

  const teamIdMap = new Map<string, string>();
  for (const team of plan.teams) {
    const created = await teamsCrudHandlers.serverCreate({
      tenancy,
      data: team.body,
    });
    teamIdMap.set(team.externalOrganizationId, created.id);
  }

  for (const membership of plan.memberships) {
    const stackUserId = userIdMap.get(membership.externalUserId);
    if (stackUserId == null) {
      throw new Error(`External membership ${membership.externalMembershipId} references missing user ${membership.externalUserId}`);
    }
    const stackTeamId = teamIdMap.get(membership.externalOrganizationId);
    if (stackTeamId == null) {
      throw new Error(`External membership ${membership.externalMembershipId} references missing organization ${membership.externalOrganizationId}`);
    }
    await teamMembershipsCrudHandlers.serverCreate({
      tenancy,
      team_id: stackTeamId,
      user_id: stackUserId,
      data: {},
    });
  }

  return {
    userIdMap: Object.fromEntries(userIdMap),
    teamIdMap: Object.fromEntries(teamIdMap),
    importedUsers: userIdMap.size,
    importedTeams: teamIdMap.size,
    importedMemberships: plan.memberships.length,
  };
}
