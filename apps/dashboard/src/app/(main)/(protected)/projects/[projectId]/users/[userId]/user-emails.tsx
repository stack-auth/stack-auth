"use client";

import { DesignBadge } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Skeleton, Typography } from "@/components/ui";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import type { DataGridColumnDef } from "@hexclave/dashboard-ui-components";
import type { AdminEmailOutbox, ServerUser } from "@hexclave/next";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import { UserPageTableSection } from "./user-page-table-section";
import { STATUS_LABELS, computeEmailStats, getStatusBadgeColor } from "../../email-sent/email-status-utils";
import { getRecipientDisplay, getEmailTimestamp } from "../../email-sent/email-outbox-utils";
import { StatsBar } from "../../email-sent/stats-bar";

const emailColumns: DataGridColumnDef<AdminEmailOutbox>[] = [
  {
    id: "subject",
    header: "Subject",
    width: 240,
    flex: 1,
    sortable: false,
    renderCell: ({ row }) => {
      if (!row.hasRendered) {
        return <span className="text-muted-foreground italic">Not yet rendered</span>;
      }
      return <span className="truncate">{row.subject}</span>;
    },
  },
  {
    id: "recipient",
    header: "Recipient",
    width: 200,
    sortable: false,
    renderCell: ({ row }) => (
      <span className="truncate text-sm text-muted-foreground">{getRecipientDisplay(row)}</span>
    ),
  },
  {
    id: "time",
    header: "Time",
    width: 160,
    sortable: false,
    renderCell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {getEmailTimestamp(row).toLocaleString()}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    width: 120,
    sortable: false,
    renderCell: ({ row }) => (
      <DesignBadge label={STATUS_LABELS[row.status]} color={getStatusBadgeColor(row.status)} size="sm" />
    ),
  },
];

export function UserEmailsSection({ user }: { user: ServerUser }) {
  const hexclaveAdminApp = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const [emails, setEmails] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshEmails = useCallback(async (isCancelled: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const allEmails: AdminEmailOutbox[] = [];
      let cursor: string | undefined;
      do {
        const result = await hexclaveAdminApp.listOutboxEmails({
          userId: user.id,
          cursor,
        });
        if (isCancelled()) return;
        allEmails.push(...result.items);
        cursor = result.nextCursor ?? undefined;
      } while (cursor != null);
      setEmails(allEmails);
    } catch (err) {
      if (isCancelled()) return;
      setError(err instanceof Error ? err.message : "Failed to load emails");
    } finally {
      if (isCancelled()) return;
      setLoading(false);
    }
  }, [hexclaveAdminApp, user.id]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      await refreshEmails(() => cancelled);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshEmails]);

  const sortedEmails = useMemo(
    () => [...emails]
      .sort((a, b) => getEmailTimestamp(b).getTime() - getEmailTimestamp(a).getTime()),
    [emails],
  );
  const stats = useMemo(() => computeEmailStats(sortedEmails), [sortedEmails]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-[40px] rounded-2xl" />
        <Skeleton className="h-[180px] rounded-2xl" />
      </div>
    );
  }

  if (error != null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <EnvelopeSimpleIcon className="h-6 w-6 text-destructive" />
        <Typography className="text-sm font-medium">Failed to load emails</Typography>
        <Typography variant="secondary" className="text-sm">{error}</Typography>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sortedEmails.length > 0 && (
        <div className="py-1">
          <div className="mb-2 text-sm text-center">
            <span className="font-medium">{sortedEmails.length} email{sortedEmails.length !== 1 ? "s" : ""}</span>
          </div>
          <StatsBar data={stats} />
        </div>
      )}

      <UserPageTableSection
        title="Sent Emails"
        urlStateKey="useremails"
        columns={emailColumns}
        rows={sortedEmails}
        getRowId={(email) => email.id}
        emptyLabel="No emails sent to this user"
        paginated
        onRowClick={(row) => {
          router.push(urlString`/projects/${projectId}/email-viewer/${row.id}`);
        }}
      />
    </div>
  );
}
