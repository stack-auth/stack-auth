import { getPublicEnvVar } from "@/lib/env";
import { stackServerApp } from "@/stack";
import { redirect } from "next/navigation";
import Footer from "./footer";
import PageClient from "./page-client";
import PreviewProjectRedirect from "./preview-project-redirect";

export const metadata = {
  title: "Projects",
};

export default async function Page() {
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

  if (isPreview) {
    // In preview mode, don't use { or: "redirect" } — the client layout handles
    // credential sign-up, and we can't redirect before that completes.
    const user = await stackServerApp.getUser();
    if (user) {
      const projects = await user.listOwnedProjects();
      if (projects.length > 0) {
        redirect(`/projects/${encodeURIComponent(projects[0].id)}`);
      }
    }
    return <PreviewProjectRedirect />;
  }

  const user = await stackServerApp.getUser({ or: "redirect" });
  const projects = await user.listOwnedProjects();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  if (projects.length === 0 && !isLocalEmulator) {
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
      <PageClient />
      <Footer />
    </>
  );
}
