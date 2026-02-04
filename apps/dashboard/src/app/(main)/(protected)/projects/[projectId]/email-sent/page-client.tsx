"use client";

import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { Badge, DataTable, Switch, Typography } from "@/components/ui";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";

// Status labels for display
const STATUS_LABELS: Record<AdminEmailOutboxStatus, string> = {
  "paused": "Paused",
  "preparing": "Preparing",
  "rendering": "Rendering",
  "render-error": "Render Error",
  "scheduled": "Scheduled",
  "queued": "Queued",
  "sending": "Sending",
  "server-error": "Server Error",
  "skipped": "Skipped",
  "bounced": "Bounced",
  "delivery-delayed": "Delivery Delayed",
  "sent": "Sent",
  "opened": "Opened",
  "clicked": "Clicked",
  "marked-as-spam": "Marked as Spam",
};

function getStatusBadgeVariant(status: AdminEmailOutboxStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paused": {
      return "outline";
    }
    case "preparing":
    case "rendering":
    case "scheduled":
    case "queued":
    case "sending": {
      return "default";
    }
    case "sent":
    case "opened":
    case "clicked":
    case "skipped":
    case "delivery-delayed": {
      return "secondary";
    }
    case "bounced":
    case "server-error":
    case "render-error": {
      return "destructive";
    }
    case "marked-as-spam": {
      return "outline";
    }
    default: {
      return "default";
    }
  }
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

function ViewModeToggle({
  mode,
  onModeChange,
}: {
  mode: ViewMode,
  onModeChange: (mode: ViewMode) => void,
}) {
  const isListMode = mode === "list";

  return (
    <div className="flex items-center gap-2">
      <Typography className="text-sm">Group by template/draft</Typography>
      <Switch
        checked={isListMode}
        onCheckedChange={(checked) => onModeChange(checked ? "list" : "grouped")}
      />
      <Typography className="text-sm">List all</Typography>
    </div>
  );
}

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
        <Badge variant={getStatusBadgeVariant(status)}>
          {STATUS_LABELS[status]}
        </Badge>
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
    runAsynchronously(async () => {
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
      <div className="flex justify-center py-4">
        <Typography>Loading email logs...</Typography>
      </div>
    );
  }

  return (
    <DataTable
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
          {/* Left side: Email Log with toggle above right corner */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-end">
              <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
            </div>
            <SettingCard title="Email Log" description="Manage email sending history">
              <EmailSendDataTable />
            </SettingCard>
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
