"use client";

import { DesignBadge } from "@/components/design-components";
import { DesignCard } from "@/components/design-components";
import { DesignPillToggle } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { Envelope } from "@phosphor-icons/react";
import { AdminEmailOutbox } from "@hexclave/next";
import {
  DataGrid,
  applyQuickSearch,
  buildRowComparator,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridExportField,
  type DataGridExportScope,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";
import { STATUS_LABELS, getStatusBadgeColor } from "./email-status-utils";
import { GroupedEmailTable } from "./grouped-email-table";

type EmailWithSubject = AdminEmailOutbox & {
  subject?: string | null,
};

type EmailWithDeliveredAt = AdminEmailOutbox & {
  deliveredAt?: Date | string | null,
};

function hasSubject(email: AdminEmailOutbox): email is EmailWithSubject {
  return "subject" in email;
}

function hasDeliveredAt(email: AdminEmailOutbox): email is EmailWithDeliveredAt {
  return "deliveredAt" in email;
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  } else if (to.type === "user-custom-emails") {
    return to.emails.length > 0 ? to.emails[0] : `User: ${to.userId.slice(0, 8)}...`;
  } else {
    return to.emails.length > 0 ? to.emails[0] : "No recipients";
  }
}

function getSubjectDisplay(email: AdminEmailOutbox): string {
  const subject = hasSubject(email) ? email.subject : undefined;
  return subject || "(Not yet rendered)";
}

function getTimeValue(email: AdminEmailOutbox): Date {
  const deliveredAt = hasDeliveredAt(email) ? email.deliveredAt : undefined;
  if (deliveredAt) {
    return new Date(deliveredAt);
  }
  return email.scheduledAt;
}

type ViewMode = "grouped" | "list";

const VIEW_MODE_OPTIONS = [
  { id: "grouped", label: "Group by template/draft" },
  { id: "list", label: "List all" },
] as const;

const emailTableColumns: DataGridColumnDef<AdminEmailOutbox>[] = [
  {
    id: "recipient",
    header: "Recipient",
    width: 160,
    minWidth: 96,
    type: "string",
    accessor: (row) => getRecipientDisplay(row),
  },
  {
    id: "subject",
    header: "Subject",
    width: 180,
    minWidth: 120,
    flex: 1,
    type: "string",
    accessor: (row) => getSubjectDisplay(row),
  },
  {
    id: "scheduledAt",
    header: "Time",
    width: 140,
    minWidth: 100,
    type: "dateTime",
    accessor: (row) => getTimeValue(row),
  },
  {
    id: "status",
    header: "Status",
    width: 120,
    minWidth: 108,
    renderCell: ({ row }) => {
      const status = row.status;
      return (
        <DesignBadge
          label={STATUS_LABELS[status]}
          color={getStatusBadgeColor(status)}
          size="sm"
        />
      );
    },
  },
];

const OUTBOX_PAGE_SIZE = 50;

const EMAIL_EXPORT_FIELDS: DataGridExportField<AdminEmailOutbox>[] = [
  { key: "id", label: "Email ID", enabled: true, getValue: (email) => email.id },
  { key: "subject", label: "Subject", enabled: true, getValue: (email) => getSubjectDisplay(email) },
  { key: "recipient", label: "Recipient", enabled: true, getValue: (email) => getRecipientDisplay(email) },
  { key: "status", label: "Status", enabled: true, getValue: (email) => STATUS_LABELS[email.status] },
  { key: "scheduledAt", label: "Scheduled At", enabled: true, getValue: (email) => email.scheduledAt.toISOString() },
  { key: "createdAt", label: "Created At", enabled: true, getValue: (email) => email.createdAt.toISOString() },
];

function EmailSendDataTable() {
  const hexclaveAdminApp = useAdminApp();
  const router = useRouter();

  const [gridState, setGridState] = useDataGridUrlState(emailTableColumns, {
    paramPrefix: "sentemails",
    initial: { sorting: [{ columnId: "scheduledAt", direction: "desc" }] },
  });

  const dataSource = useMemo<DataGridDataSource<AdminEmailOutbox>>(
    () => async function* (params) {
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = await hexclaveAdminApp.listOutboxEmails({
        limit: OUTBOX_PAGE_SIZE,
        cursor,
      });
      yield {
        rows: result.items,
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [hexclaveAdminApp],
  );

  const getRowId = useCallback((row: AdminEmailOutbox) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns: emailTableColumns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  const fetchExportRows = useCallback(async (options: {
    scope: DataGridExportScope,
    onProgress: (fetched: number) => void,
  }) => {
    const allEmails: AdminEmailOutbox[] = [];
    let cursor: string | undefined = undefined;
    const limit = 100;

    do {
      const result = await hexclaveAdminApp.listOutboxEmails({
        limit,
        cursor,
      });

      allEmails.push(...result.items);
      options.onProgress(allEmails.length);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);

    if (options.scope === "filtered") {
      const searchedEmails = applyQuickSearch(allEmails, gridState.quickSearch, emailTableColumns);
      const comparator = buildRowComparator(gridState.sorting, emailTableColumns);
      return comparator == null ? searchedEmails : [...searchedEmails].sort(comparator);
    }

    return allEmails;
  }, [gridState.quickSearch, gridState.sorting, hexclaveAdminApp]);

  if (gridData.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Spinner size={16} />
        <Typography variant="secondary">Loading emails...</Typography>
      </div>
    );
  }

  return (
    <div className="min-w-0 w-full">
      <DataGrid
        className="min-w-0"
        columns={emailTableColumns}
        rows={gridData.rows}
        getRowId={getRowId}
        totalRowCount={gridData.totalRowCount}
        isLoading={gridData.isLoading}
        isRefetching={gridData.isRefetching}
        state={gridState}
        onChange={setGridState}
        paginationMode="infinite"
        hasMore={gridData.hasMore}
        isLoadingMore={gridData.isLoadingMore}
        onLoadMore={gridData.loadMore}
        fillHeight={false}
        footer={false}
        exportOptions={{
          title: "Export Sent Emails",
          description: "Configure and download sent email log data from your project",
          entityName: "email",
          entityNamePlural: "emails",
          filenamePrefix: "stack-email-sent-export",
          fields: EMAIL_EXPORT_FIELDS,
          fetchRows: fetchExportRows,
          emptyExportTitle: "No emails to export",
          emptyExportDescription: "There are no emails matching the current filters",
          allScopeLabel: "Export all emails in the project",
          filteredScopeLabel: "Export only filtered/searched emails",
        }}
        onRowClick={(row) => {
          router.push(`email-viewer/${row.id}`);
        }}
      />
    </div>
  );
}

export default function PageClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Sent"
        description="View email logs and domain reputation"
      >
        <div data-walkthrough="emails-sent" className="flex flex-col xl:flex-row gap-6 min-w-0">
          {/* Left side: Email Log with toggle inside card */}
          <div className="order-2 xl:order-1 flex-1 flex flex-col gap-4 min-w-0">
            <DesignCard
              className="min-w-0"
              contentClassName="p-3 min-w-0"
              gradient="default"
              glassmorphic
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-foreground/[0.06] dark:bg-foreground/[0.04]">
                    <Envelope className="h-3 w-3 text-foreground/70 dark:text-muted-foreground" />
                  </div>
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Email Log
                  </span>
                </div>
                <DesignPillToggle
                  options={[...VIEW_MODE_OPTIONS]}
                  selected={viewMode}
                  onSelect={(id) => setViewMode(id as ViewMode)}
                  size="sm"
                  gradient="default"
                />
              </div>
              {viewMode === "list" ? <EmailSendDataTable /> : <GroupedEmailTable />}
            </DesignCard>
          </div>

          {/* Right side: Domain Reputation */}
          <div className="order-1 xl:order-2 flex-shrink-0">
            <DomainReputationCard />
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
