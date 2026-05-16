"use server";
import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";

async function getStackServerApp() {
  if (isRemoteDevelopmentEnvironmentEnabled()) {
    throw new Error("Team invitation management is not available in the remote development environment dashboard.");
  }
  return (await import("@/stack/server")).stackServerApp;
}

export async function revokeInvitation(teamId: string, invitationId: string) {
  "use server";
  const stackServerApp = await getStackServerApp();
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
  const stackServerApp = await getStackServerApp();
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
  const stackServerApp = await getStackServerApp();
  const callbackUrl = new URL(stackServerApp.urls.teamInvitation, origin).toString();
  const user = await stackServerApp.getUser();
  const team = await user?.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  await team.inviteUser({ email, callbackUrl });
}
