import { stackServerApp } from "@/stack";
import { redirect } from "next/navigation";
import Footer from "./footer";
import PageClient from "./page-client";

export const metadata = {
  title: "Projects",
};

// internal users don't have team permission to invite users, so we use server function instead
async function inviteUser(origin: string, teamId: string, email: string) {
  "use server";
  const team = await stackServerApp.getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  await team.inviteUser({
    email,
    callbackUrl: new URL(stackServerApp.urls.teamInvitation, origin).toString()
  });
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

      <PageClient inviteUser={inviteUser} />
      <Footer />
    </>
  );
}
