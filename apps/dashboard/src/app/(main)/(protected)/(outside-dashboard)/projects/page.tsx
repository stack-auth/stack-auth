import { stackServerApp } from "@/stack";
import { redirect } from "next/navigation";
import Footer from "./footer";
import PageClient from "./page-client";

export const metadata = {
  title: "Projects",
};

export default async function Page() {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const projects = await user.listOwnedProjects();
  if (projects.length === 0) {
    redirect("/new-project");
  }

  return (
    <>
      {/* Dotted background */}
      <div>
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle, rgba(127, 127, 127, 0.15) 1px, transparent 1px)',
          backgroundSize: '10px 10px',
        }} />
      </div>

      <PageClient />
      <Footer />
    </>
  );
}
