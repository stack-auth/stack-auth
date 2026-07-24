"use client";

import { AppEnabledGuard } from "../../../../../app-enabled-guard";
import { useProjectId } from "../../../../../use-admin-app";
import { GtmDataProvider } from "@/lib/gtm/gtm-data";
import { useUser } from "@hexclave/next";
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

  if (projectId !== "internal") return notFound();
  if (suggestionType !== "insights" && suggestionType !== "actions") return notFound();

  return (
    <AppEnabledGuard appId="gtm">
      <GtmDataProvider demo={false} projectId={targetProjectId}>
        <CustomerSuggestionReport
          id={suggestionId}
          type={suggestionType === "insights" ? "insight" : "action"}
          adminTargetProjectId={targetProjectId}
        />
      </GtmDataProvider>
    </AppEnabledGuard>
  );
}
