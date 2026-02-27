"use client";

import { DesignBadge } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { DesignPillToggle } from "@/components/design-components/pill-toggle";
import { DesignDataTable } from "@/components/design-components/table";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { Envelope } from "@phosphor-icons/react";
import { AdminEmailOutbox } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";
import { STATUS_LABELS, getStatusBadgeColor } from "./email-status-utils";
import { GroupedEmailTable } from "./grouped-email-table";

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
  // Subject is only available after rendering
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Safe access for display, subject may not exist on all status variants
  const subject = (email as any).subject;
  return subject || "(Not yet rendered)";
}

function getTimeDisplay(email: AdminEmailOutbox): string {
  // Show delivered time if available, otherwise scheduled time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Safe access for display, deliveredAt may not exist on all status variants
  const deliveredAt = (email as any).deliveredAt;
  if (deliveredAt) {
    return new Date(deliveredAt).toLocaleString();
  }
  return email.scheduledAt.toLocaleString();
}

type ViewMode = "grouped" | "list";

const VIEW_MODE_OPTIONS = [
  { id: "grouped", label: "Group by template/draft" },
  { id: "list", label: "List all" },
] as const;

const emailTableColumns: ColumnDef<AdminEmailOutbox>[] = [
  {
    accessorKey: "recipient",
    header: "Recipient",
    cell: ({ row }) => getRecipientDisplay(row.original),
  },
  {
    accessorKey: "subject",
    header: "Subject",
    cell: ({ row }) => getSubjectDisplay(row.original),
  },
  {
    accessorKey: "scheduledAt",
    header: "Time",
    cell: ({ row }) => getTimeDisplay(row.original),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Spinner size={16} />
        <Typography variant="secondary">Loading emails...</Typography>
      </div>
    );
  }

  return (
    <DesignDataTable
      data={emailLogs}
      defaultColumnFilters={[]}
      columns={emailTableColumns}
      defaultSorting={[{ id: "scheduledAt", desc: true }]}
      onRowClick={(email) => {
        router.push(`email-viewer/${email.id}`);
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
        <div className="flex gap-6">
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
