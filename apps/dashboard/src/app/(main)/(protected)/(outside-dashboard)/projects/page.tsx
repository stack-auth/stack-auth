import { stackServerApp } from "@/stack";
import { redirect } from "next/navigation";
import Footer from "./footer";
import type { SerializedTeamInvitation } from "./page-client";
import PageClient from "./page-client";

export const metadata = {
  title: "Projects",
};

// internal users don't have team permission to invite users, so we use server function instead
async function inviteUser(origin: string, teamId: string, email: string) {
  "use server";
  const user = await stackServerApp.getUser({ or: "throw" });
  const team = await user.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  await team.inviteUser({
    email,
    callbackUrl: new URL(stackServerApp.urls.teamInvitation, origin).toString()
  });
}

async function listTeamInvitations(teamId: string): Promise<SerializedTeamInvitation[]> {
  "use server";
  const user = await stackServerApp.getUser({ or: "throw" });
  const team = await user.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const invitations = await team.listInvitations();
  return invitations.map((invitation) => ({
    id: invitation.id,
    recipientEmail: invitation.recipientEmail,
    expiresAt: invitation.expiresAt.toISOString(),
  }));
}

async function revokeTeamInvitation(teamId: string, invitationId: string): Promise<void> {
  "use server";
  const user = await stackServerApp.getUser({ or: "throw" });
  const team = await user.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const invitations = await team.listInvitations();
  const invitation = invitations.find((entry) => entry.id === invitationId);
  if (!invitation) {
    throw new Error("Invitation not found");
  }
  await invitation.revoke();
}

export default async function Page() {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const projects = await user.listOwnedProjects();
  if (projects.length === 0) {
    redirect("/new-project");
  }

  return (
    <>
      {/* Dotted background */}
      <div
        inert
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle, rgba(127, 127, 127, 0.15) 1px, transparent 1px)',
          backgroundSize: '10px 10px',
        }}
      />

      <PageClient
        inviteUser={inviteUser}
        revokeTeamInvitation={revokeTeamInvitation}
        allTeamInvitations={allTeamInvitationsPromise}
      />
      <Footer />
    </>
  );
}
