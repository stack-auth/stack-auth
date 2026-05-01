import type { JsonObject, StackMigrationPlan } from "./types";

export type StackApiConfig = {
  apiUrl: string,
  projectId: string,
  secretServerKey: string,
  publishableClientKey?: string,
  branchId?: string,
};

export type StackImportResult = {
  userIdMap: Map<string, string>,
  teamIdMap: Map<string, string>,
};

async function stackFetch<TBody>(
  config: StackApiConfig,
  path: string,
  method: "POST",
  body: TBody,
): Promise<unknown> {
  const response = await fetch(new URL(path, config.apiUrl), {
    method,
    headers: {
      "content-type": "application/json",
      "x-stack-access-type": "server",
      "x-stack-project-id": config.projectId,
      "x-stack-secret-server-key": config.secretServerKey,
      ...(config.publishableClientKey != null ? { "x-stack-publishable-client-key": config.publishableClientKey } : {}),
      ...(config.branchId != null ? { "x-stack-branch-id": config.branchId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const responseBody = text === "" ? null : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`Stack Auth ${method} ${path} failed with ${response.status}: ${text}`);
  }
  return responseBody;
}

function readIdFromStackResponse(value: unknown, path: string): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  throw new Error(`Stack Auth response for ${path} did not include an id`);
}

function withMembershipMetadata(body: JsonObject): JsonObject {
  return body;
}

export async function importPlanToStackAuth(config: StackApiConfig, plan: StackMigrationPlan): Promise<StackImportResult> {
  const userIdMap = new Map<string, string>();
  for (const user of plan.users) {
    const response = await stackFetch(config, "/api/v1/users", "POST", user.body);
    userIdMap.set(user.externalUserId, readIdFromStackResponse(response, "/api/v1/users"));
  }

  const teamIdMap = new Map<string, string>();
  for (const team of plan.teams) {
    const response = await stackFetch(config, "/api/v1/teams", "POST", team.body);
    teamIdMap.set(team.externalOrganizationId, readIdFromStackResponse(response, "/api/v1/teams"));
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
    await stackFetch(config, `/api/v1/team-memberships/${stackTeamId}/${stackUserId}`, "POST", withMembershipMetadata({}));
  }

  return { userIdMap, teamIdMap };
}
