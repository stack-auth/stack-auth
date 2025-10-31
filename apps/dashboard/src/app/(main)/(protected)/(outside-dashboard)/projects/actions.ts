"use server";
import { stackServerApp } from "@/stack";

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

export async function inviteUser(teamId: string, email: string, callbackUrl: string) {
  const user = await stackServerApp.getUser();
  const team = await user?.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  await team.inviteUser({ email, callbackUrl });
}
