"use client";

import { DesignBadge } from "@/components/design-components";
import { DesignCard } from "@/components/design-components";
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
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApp, useProjectId } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";
import { STATUS_LABELS, computeEmailStats, getStatusBadgeColor } from "./email-status-utils";
import { StatsBar } from "./stats-bar";

type EmailWithDeliveredAt = AdminEmailOutbox & {
  deliveredAt?: Date | string | null,
};

function hasDeliveredAt(email: AdminEmailOutbox): email is EmailWithDeliveredAt {
  return "deliveredAt" in email;
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  }
  if (to.type === "user-custom-emails") {
    return to.emails[0] ?? `User: ${to.userId.slice(0, 8)}...`;
  }
  return to.emails[0] ?? "No recipients";
}

function getEmailTimestamp(email: AdminEmailOutbox): Date {
  const deliveredAt = hasDeliveredAt(email) ? email.deliveredAt : undefined;
  return deliveredAt ? new Date(deliveredAt) : email.scheduledAt;
}

const emailColumns: DataGridColumnDef<AdminEmailOutbox>[] = [
  {
    id: "recipient",
    header: "Recipient",
    width: 200,
    type: "string",
    accessor: (row) => getRecipientDisplay(row),
  },
  {
    id: "scheduledAt",
    header: "Time",
    accessor: (row) => getEmailTimestamp(row),
    width: 180,
    type: "dateTime",
  },
  {
    id: "status",
    header: "Status",
    width: 120,
    renderCell: ({ row }) => (
      <DesignBadge label={STATUS_LABELS[row.status]} color={getStatusBadgeColor(row.status)} size="sm" />
    ),
  },
];

type SentEmailsViewProps = {
  filterFn: (email: AdminEmailOutbox) => boolean,
  renderActions?: (emails: AdminEmailOutbox[], refresh: () => Promise<void>) => ReactNode,
};

export function SentEmailsView({ filterFn, renderActions }: SentEmailsViewProps) {
  const stackAdminApp = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const [emails, setEmails] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshEmails = useCallback(async () => {
    setLoading(true);
    try {
      const result = await stackAdminApp.listOutboxEmails();
      setEmails(result.items);
    } finally {
      setLoading(false);
    }
  }, [stackAdminApp]);

  useEffect(() => {
    runAsynchronouslyWithAlert(refreshEmails);
  }, [refreshEmails]);

  const filtered = useMemo(() => emails.filter(filterFn), [emails, filterFn]);
  const stats = useMemo(() => computeEmailStats(filtered), [filtered]);

  const [gridState, setGridState] = useState<DataGridState>(() => ({
    ...createDefaultDataGridState(emailColumns),
    sorting: [{ columnId: "scheduledAt", direction: "desc" }],
  }));

  const gridData = useDataSource({
    data: filtered,
    columns: emailColumns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <div className="flex gap-4">
      <div className="flex-1 flex flex-col gap-4">
        {renderActions && !loading && filtered.length > 0 && renderActions(filtered, refreshEmails)}

        {/* Delivery Stats */}
        <DesignCard gradient="default" glassmorphic contentClassName="p-3">
          <div className="py-1">
            <div className="mb-2 text-sm text-center">
              <span className="font-medium">{filtered.length} email{filtered.length !== 1 ? "s" : ""}</span>
            </div>
            <StatsBar data={stats} />
          </div>
        </DesignCard>

        {/* Email Log */}
        <DesignCard gradient="default" glassmorphic contentClassName="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1 rounded-md bg-foreground/[0.06] dark:bg-foreground/[0.04]">
              <Envelope className="h-3 w-3 text-foreground/70 dark:text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
              Recipients
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8">
              <Spinner size={16} />
              <Typography variant="secondary">Loading...</Typography>
            </div>
          ) : (
            <DataGrid
              columns={emailColumns}
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
                router.push(`/projects/${projectId}/email-viewer/${row.id}`);
              }}
            />
          )}
        </DesignCard>
      </div>

      <div className="flex-shrink-0">
        <DomainReputationCard />
      </div>
    </div>
  );
}
