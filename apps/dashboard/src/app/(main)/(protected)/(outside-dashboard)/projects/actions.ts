"use server";
import { stackServerApp } from "@/stack";
import { createUrlIfValid, isLocalhost, matchHostnamePattern } from "@stackframe/stack-shared/dist/utils/urls";

async function assertTrustedOrigin(teamId: string, origin: string): Promise<URL> {
  const originUrl = createUrlIfValid(origin);
  if (!originUrl) {
    throw new Error("Invalid origin");
  }

  const user = await stackServerApp.getUser({ or: "throw" });
  const ownedProjects = await user.listOwnedProjects();
  const relevantProjects = ownedProjects.filter(project => project.ownerTeamId === teamId);
  const projectsToCheck = relevantProjects.length > 0 ? relevantProjects : ownedProjects;

  if (projectsToCheck.some(project => project.config.allowLocalhost) && isLocalhost(originUrl)) {
    return originUrl;
  }

  const isTrusted = projectsToCheck.some(project =>
    project.config.domains.some(({ domain }) => domainMatches(originUrl, domain))
  );

  if (!isTrusted) {
    throw new Error("Origin is not a trusted domain");
  }

  return originUrl;
}

function domainMatches(origin: URL, pattern: string): boolean {
  const configuredUrl = createUrlIfValid(pattern);
  if (configuredUrl) {
    return configuredUrl.protocol === origin.protocol && configuredUrl.host === origin.host;
  }

  const match = pattern.match(/^([^:]+:\/\/)([^/]+)$/);
  if (!match) {
    return false;
  }

  const [, protocol, hostPattern] = match;
  if (origin.protocol + "//" !== protocol) {
    return false;
  }

  const target = hostPattern.includes(":") ? origin.host : origin.hostname;
  return matchHostnamePattern(hostPattern, target);
}

export async function revokeInvitation(teamId: string, invitationId: string) {
  "use server";
  const user = await stackServerApp.getUser();
  const team = await user?.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const invite = await team.listInvitations().then(invites => invites.find(invite => invite.id === invitationId));
  if (!invite) {
    throw new Error("Invitation not found");
  }
  await invite.revoke();
}

export async function listInvitations(teamId: string) {
  const user = await stackServerApp.getUser();
  const team = await user?.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const invitations = await team.listInvitations();
  return invitations.map(invite => ({
    id: invite.id,
    recipientEmail: invite.recipientEmail,
    expiresAt: invite.expiresAt,
  }));
}

export async function inviteUser(teamId: string, email: string, origin: string) {
  const originUrl = await assertTrustedOrigin(teamId, origin);
  const callbackUrl = new URL(stackServerApp.urls.teamInvitation, originUrl).toString();
  const user = await stackServerApp.getUser();
  const team = await user?.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  await team.inviteUser({ email, callbackUrl });
}
