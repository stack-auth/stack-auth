"use client";

import { useCallback } from "react";
import { AdminEmailOutbox } from "@stackframe/stack";
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
      <PageLayout title="Sent: No Template/Draft">
        <SentEmailsView filterFn={filterFn} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
