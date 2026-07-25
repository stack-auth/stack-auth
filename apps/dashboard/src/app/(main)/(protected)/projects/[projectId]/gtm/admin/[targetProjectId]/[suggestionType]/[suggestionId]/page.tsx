"use client";

import { AppEnabledGuard } from "../../../../../app-enabled-guard";
import { useProjectId } from "../../../../../use-admin-app";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { useStackApp, useUser } from "@hexclave/next";
import { notFound, useParams } from "next/navigation";
import { CustomerSuggestionReport } from "../../../../components/customer-suggestion-report";

export default function Page() {
  const projectId = useProjectId();
  const { targetProjectId, suggestionType, suggestionId } = useParams<{
    targetProjectId: string,
    suggestionType: string,
    suggestionId: string,
  }>();
  useUser({ or: "redirect", projectIdMustMatch: "internal" });
  // Reading another project's records is a platform-admin action, so it goes through the dashboard's own
  // internal-project session rather than that project's admin app (which this page doesn't hold).
  const app = useStackApp();

  if (projectId !== "internal") return notFound();
  if (suggestionType !== "insights" && suggestionType !== "actions") return notFound();

  return (
    <AppEnabledGuard appId="gtm">
      <GtmDataProvider demo={false} app={app} target={{ kind: "managed-project", projectId: targetProjectId }}>
        <CustomerSuggestionReport
          id={suggestionId}
          type={suggestionType === "insights" ? "insight" : "action"}
          adminTargetProjectId={targetProjectId}
        />
      </GtmDataProvider>
    </AppEnabledGuard>
  );
}
