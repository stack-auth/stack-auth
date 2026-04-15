"use client";

import { DesignBadge } from "@/components/design-components";
import { DesignCard } from "@/components/design-components";
import { DesignPillToggle } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { Envelope } from "@phosphor-icons/react";
import { AdminEmailOutbox } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { useEffect, useState } from "react";
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
    width: 200,
    type: "string",
    accessor: (row) => getRecipientDisplay(row),
  },
  {
    id: "subject",
    header: "Subject",
    width: 220,
    flex: 1,
    type: "string",
    accessor: (row) => getSubjectDisplay(row),
  },
  {
    id: "scheduledAt",
    header: "Time",
    width: 180,
    type: "dateTime",
    accessor: (row) => getTimeValue(row),
  },
  {
    id: "status",
    header: "Status",
    width: 120,
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

function EmailSendDataTable() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [emailLogs, setEmailLogs] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    runAsynchronouslyWithAlert(async () => {
      setLoading(true);
      try {
        const result = await stackAdminApp.listOutboxEmails();
        setEmailLogs(result.items);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  const [gridState, setGridState] = useState<DataGridState>(() => ({
    ...createDefaultDataGridState(emailTableColumns),
    sorting: [{ columnId: "scheduledAt", direction: "desc" }],
  }));

  const gridData = useDataSource({
    data: emailLogs,
    columns: emailTableColumns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Spinner size={16} />
        <Typography variant="secondary">Loading emails...</Typography>
      </div>
    );
  }

  return (
    <DataGrid
      columns={emailTableColumns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}

      onRowClick={(row) => {
        router.push(`email-viewer/${row.id}`);
      }}
    />
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
        <div data-walkthrough="emails-sent" className="flex gap-6">
          {/* Left side: Email Log with toggle inside card */}
          <div className="flex-1 flex flex-col gap-4">
            <DesignCard
              contentClassName="p-3"
              gradient="default"
              glassmorphic
            >
              <div className="flex items-center justify-between mb-2">
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
          <div className="flex-shrink-0">
            <DomainReputationCard />
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
