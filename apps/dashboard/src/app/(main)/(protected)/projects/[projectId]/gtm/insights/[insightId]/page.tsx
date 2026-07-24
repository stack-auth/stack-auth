"use client";

import { AppEnabledGuard } from "../../../app-enabled-guard";
import { useProjectId } from "../../../use-admin-app";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { CustomerSuggestionReport } from "../../components/customer-suggestion-report";

export default function Page() {
  const projectId = useProjectId();
  const { insightId } = useParams<{ insightId: string }>();
  const searchParams = useSearchParams();

  if (projectId === "internal") return notFound();

  return (
    <AppEnabledGuard appId="gtm">
      <GtmDataProvider demo={searchParams.get("demo") !== "false"}>
        <CustomerSuggestionReport id={insightId} type="insight" />
      </GtmDataProvider>
    </AppEnabledGuard>
  );
}
