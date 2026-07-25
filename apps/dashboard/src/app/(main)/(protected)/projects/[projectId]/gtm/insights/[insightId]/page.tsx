"use client";

import { AppEnabledGuard } from "../../../app-enabled-guard";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { CustomerSuggestionReport } from "../../components/customer-suggestion-report";

export default function Page() {
  const projectId = useProjectId();
  // A project's live GTM records only come back through its own admin app; the dashboard app is authenticated
  // against the `internal` project and would read the internal workspace instead.
  const app = useAdminApp();
  const { insightId } = useParams<{ insightId: string }>();
  const searchParams = useSearchParams();

  if (projectId === "internal") return notFound();

  return (
    <AppEnabledGuard appId="gtm">
      <GtmDataProvider demo={searchParams.get("demo") !== "false"} app={app} target={{ kind: "own-project" }}>
        <CustomerSuggestionReport id={insightId} type="insight" />
      </GtmDataProvider>
    </AppEnabledGuard>
  );
}
