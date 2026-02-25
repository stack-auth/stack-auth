"use client";

import { DesignBadge } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { DesignDataTable } from "@/components/design-components/table";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { Envelope } from "@phosphor-icons/react";
import { AdminEmailOutbox } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { useAdminApp, useProjectId } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";
import { STATUS_LABELS, computeEmailStats, getStatusBadgeColor } from "./email-status-utils";
import { StatsBar } from "./stats-bar";

const emailColumns: ColumnDef<AdminEmailOutbox>[] = [
  {
    accessorKey: "recipient",
    header: "Recipient",
    cell: ({ row }) => {
      const to = row.original.to;
      if (to.type === "user-primary-email") return `User: ${to.userId.slice(0, 8)}...`;
      if (to.type === "user-custom-emails") return to.emails[0] ?? `User: ${to.userId.slice(0, 8)}...`;
      return to.emails[0] ?? "No recipients";
    },
  },
  {
    accessorKey: "scheduledAt",
    header: "Time",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliveredAt may not exist on all status variants
    cell: ({ row }) => ((row.original as any).deliveredAt ? new Date((row.original as any).deliveredAt).toLocaleString() : row.original.scheduledAt.toLocaleString()),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <DesignBadge label={STATUS_LABELS[row.original.status]} color={getStatusBadgeColor(row.original.status)} size="sm" />
    ),
  },
];

type SentEmailsViewProps = {
  filterFn: (email: AdminEmailOutbox) => boolean,
};

export function SentEmailsView({ filterFn }: SentEmailsViewProps) {
  const stackAdminApp = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const [emails, setEmails] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    runAsynchronouslyWithAlert(async () => {
      setLoading(true);
      try {
        const result = await stackAdminApp.listOutboxEmails();
        setEmails(result.items);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  const filtered = useMemo(() => emails.filter(filterFn), [emails, filterFn]);
  const stats = useMemo(() => computeEmailStats(filtered), [filtered]);

  return (
    <div className="flex gap-4">
      <div className="flex-1 flex flex-col gap-4">
        {/* Delivery Stats */}
        <DesignCard gradient="default" glassmorphic contentClassName="p-3">
          <div className="py-1">
            <div className="mb-2 text-sm text-center">
              <span className="font-medium">{filtered.length} email{filtered.length !== 1 ? "s" : ""}</span>
              {" — "}
              {stats.sent > 0 && <span className="text-green-600">{stats.sent} delivered</span>}
              {stats.sent > 0 && (stats.inProgress > 0 || stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && ", "}
              {stats.inProgress > 0 && <span className="text-muted-foreground">{stats.inProgress} pending</span>}
              {stats.inProgress > 0 && (stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && ", "}
              {(stats.bounced > 0 || stats.spam > 0 || stats.errors > 0) && (
                <span className="text-red-600">
                  {stats.bounced + stats.spam + stats.errors} issue{stats.bounced + stats.spam + stats.errors !== 1 ? "s" : ""}
                </span>
              )}
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
            <DesignDataTable
              data={filtered}
              defaultColumnFilters={[]}
              columns={emailColumns}
              defaultSorting={[{ id: "scheduledAt", desc: true }]}
              onRowClick={(email) => router.push(`/projects/${projectId}/email-viewer/${email.id}`)}
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
