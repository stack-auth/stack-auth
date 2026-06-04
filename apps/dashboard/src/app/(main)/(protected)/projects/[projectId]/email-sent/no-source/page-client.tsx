"use client";

import { useCallback } from "react";
import { AdminEmailOutbox } from "@hexclave/next";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { SentEmailsView } from "../sent-emails-view";

export default function PageClient() {
  const filterFn = useCallback((e: AdminEmailOutbox) => (
    (e.createdWith === "programmatic-call" && !e.emailProgrammaticCallTemplateId) ||
    (e.createdWith === "draft" && !e.emailDraftId)
  ), []);

  return (
    <AppEnabledGuard appId="emails">
      {/* allowContentOverflow: SentEmailsView renders a `fillHeight={false}`
          DataGrid inside an `overflow-hidden` DesignCard, which the default
          `flex-1 min-h-0` clamp would shrink and clip at the bottom on tall
          lists. Matches the main email-sent page. */}
      <PageLayout title="Sent: No Template/Draft" allowContentOverflow>
        <SentEmailsView filterFn={filterFn} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
