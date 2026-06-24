"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { EMAIL_STATUS_LABELS, getEmailRecipientDisplay, getEmailSubjectDisplay } from "@/components/email-export-helpers";
import { ExportDataDialog, type ExportField } from "@/components/export-data-dialog";
import type { AdminEmailOutbox } from "@hexclave/next";
import type { ReactNode } from "react";

export type ExportEmailsOptions = {
  status?: string,
  simpleStatus?: string,
};

const EMAIL_EXPORT_FIELDS: ExportField<AdminEmailOutbox>[] = [
  { key: "id", label: "Email ID", enabled: true, getValue: (email) => email.id },
  { key: "subject", label: "Subject", enabled: true, getValue: (email) => getEmailSubjectDisplay(email) },
  { key: "recipient", label: "Recipient", enabled: true, getValue: (email) => getEmailRecipientDisplay(email) },
  { key: "status", label: "Status", enabled: true, getValue: (email) => EMAIL_STATUS_LABELS[email.status] },
  { key: "scheduledAt", label: "Scheduled At", enabled: true, getValue: (email) => email.scheduledAt.toISOString() },
  { key: "createdAt", label: "Created At", enabled: true, getValue: (email) => email.createdAt.toISOString() },
];

export function ExportEmailsDialog(props: {
  trigger?: ReactNode,
  exportOptions?: ExportEmailsOptions,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  title: string,
  description: string,
  filenamePrefix: string,
  filteredScopeLabel?: ReactNode,
}) {
  const hexclaveAdminApp = useAdminApp();

  return (
    <ExportDataDialog
      trigger={props.trigger}
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      description={props.description}
      entityName="email"
      entityNamePlural="emails"
      filenamePrefix={props.filenamePrefix}
      fields={EMAIL_EXPORT_FIELDS}
      fetchRows={async ({ scope, onProgress }) => await fetchAllEmails(
        hexclaveAdminApp,
        scope === "filtered" ? props.exportOptions : undefined,
        onProgress,
      )}
      emptyExportTitle="No emails to export"
      emptyExportDescription="There are no emails matching the current filters"
      allScopeLabel="Export all emails in the project"
      filteredScopeLabel={props.filteredScopeLabel ?? "Export only filtered emails"}
    />
  );
}

async function fetchAllEmails(
  hexclaveAdminApp: ReturnType<typeof useAdminApp>,
  options: ExportEmailsOptions | undefined,
  onProgress: (fetched: number) => void,
): Promise<AdminEmailOutbox[]> {
  const allEmails: AdminEmailOutbox[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100;

  do {
    const result = await hexclaveAdminApp.listOutboxEmails({
      limit,
      cursor,
      status: options?.status,
      simpleStatus: options?.simpleStatus,
    });

    allEmails.push(...result.items);
    onProgress(allEmails.length);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);

  return allEmails;
}
