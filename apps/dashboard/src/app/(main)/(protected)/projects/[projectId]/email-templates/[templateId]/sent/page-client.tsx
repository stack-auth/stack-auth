"use client";

import { useCallback, useMemo } from "react";
import { AdminEmailOutbox } from "@stackframe/stack";
import { AppEnabledGuard } from "../../../app-enabled-guard";
import { PageLayout } from "../../../page-layout";
import { useAdminApp } from "../../../use-admin-app";
import { SentEmailsView } from "../../../email-sent/sent-emails-view";

export default function PageClient({ templateId }: { templateId: string }) {
  const stackAdminApp = useAdminApp();
  const templates = stackAdminApp.useEmailTemplates();
  const template = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);
  const templateName = template?.displayName ?? `Template (${templateId.slice(0, 8)}...)`;

  const filterFn = useCallback((e: AdminEmailOutbox) => (
    e.emailProgrammaticCallTemplateId === templateId
  ), [templateId]);

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout title={`Sent: ${templateName}`}>
        <SentEmailsView filterFn={filterFn} />
      </PageLayout>
    </AppEnabledGuard>
  );
}
