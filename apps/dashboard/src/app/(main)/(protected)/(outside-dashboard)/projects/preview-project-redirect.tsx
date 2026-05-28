'use client';

import Loading from "@/app/loading";
import { useRouter } from "@/components/router";
import { useDashboardInternalUser } from "@/lib/dashboard-user";
import { useEffect } from "react";

export default function PreviewProjectRedirect() {
  const user = useDashboardInternalUser();
  const projects = user.useOwnedProjects();
  const router = useRouter();

  useEffect(() => {
    if (projects.length === 0) return;
    const project = projects[0];
    router.replace(`/projects/${encodeURIComponent(project.id)}`);
  }, [projects, router]);

  return <Loading />;
}
