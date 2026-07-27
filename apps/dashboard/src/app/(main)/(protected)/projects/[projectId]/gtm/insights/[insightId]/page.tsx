"use client";

import { AppEnabledGuard } from "../../../app-enabled-guard";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { isGtmDemoMode } from "@/lib/gtm/gtm-mode";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { CustomerSuggestionReport } from "../../components/customer-suggestion-report";

export default function Page() {
  const projectId = useProjectId();
  // A project's live GTM records only come back through its own admin app; the dashboard app is authenticated
  // against the `internal` project and would read the internal workspace instead.
  const app = useAdminApp();
  const { insightId } = useParams<{ insightId: string }>();
  const searchParams = useSearchParams();
  const demo = isGtmDemoMode(projectId, searchParams.get("demo"));

  if (projectId === "internal" && !demo) return notFound();

  return (
    <AppEnabledGuard appId="gtm">
      <GtmDataProvider demo={demo} app={app} target={{ kind: "own-project" }}>
        <CustomerSuggestionReport id={insightId} type="insight" />
      </GtmDataProvider>
    </AppEnabledGuard>
  );
}
