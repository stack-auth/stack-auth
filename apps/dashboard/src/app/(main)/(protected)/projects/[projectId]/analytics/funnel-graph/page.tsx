"use client";

import { useRouter } from "@/components/router";
import { useEffect } from "react";
import { useAdminApp } from "../../use-admin-app";

export default function Page() {
  const adminApp = useAdminApp();
  const router = useRouter();
  useEffect(() => {
    // Must match the next.config.mjs redirect for this URL: the old
    // funnel-graph page was renamed to "paths" (the funnels page is a
    // different, new feature), so both redirects point there.
    router.replace(`/projects/${encodeURIComponent(adminApp.projectId)}/analytics/paths`);
  }, [adminApp.projectId, router]);
  return null;
}
