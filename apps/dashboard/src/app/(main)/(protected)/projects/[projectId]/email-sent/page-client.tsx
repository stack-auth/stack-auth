"use client";

import { DesignBadge, DesignBadgeColor } from "@/components/design-components/badge";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { DesignPillToggle } from "@/components/design-components/pill-toggle";
import { DesignDataTable } from "@/components/design-components/table";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { Envelope, X } from "@phosphor-icons/react";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";
import { GroupedEmailTable } from "./grouped-email-table";

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

// Badge colors matching schema colors:
// 🟢 sent → green
// 🔵 opened → blue
// 🟣 clicked → purple
// 🟡 marked-as-spam → orange (warning)
// 🔴 bounced, server-error, render-error → red
// 🔵 paused, preparing, rendering, scheduled, queued, sending, delivery-delayed, skipped → cyan (neutral/in-progress)
function getStatusBadgeColor(status: AdminEmailOutboxStatus): DesignBadgeColor {
  switch (status) {
    case "sent": {
      return "green";
    }
    case "opened": {
      return "blue";
    }
    case "clicked": {
      return "purple";
    }
    case "bounced":
    case "server-error":
    case "render-error": {
      return "red";
    }
    case "marked-as-spam": {
      return "orange";
    }
    case "paused":
    case "skipped":
    case "preparing":
    case "rendering":
    case "scheduled":
    case "queued":
    case "sending":
    case "delivery-delayed":
    default: {
      return "cyan";
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

type EmailFilter = {
  draftId?: string,
  templateId?: string,
  noSource?: boolean,
};

function EmailSendDataTable({ filter }: { filter?: EmailFilter }) {
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

  // Apply filter if provided
  const filteredEmails = useMemo(() => {
    if (!filter) {
      return emailLogs;
    }

    return emailLogs.filter((email) => {
      if (filter.draftId) {
        return email.emailDraftId === filter.draftId;
      }
      if (filter.templateId) {
        return email.emailProgrammaticCallTemplateId === filter.templateId;
      }
      if (filter.noSource) {
        // Emails without template or draft
        return (
          (email.createdWith === "programmatic-call" && !email.emailProgrammaticCallTemplateId) ||
          (email.createdWith === "draft" && !email.emailDraftId)
        );
      }
      return true;
    });
  }, [emailLogs, filter]);

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
      data={filteredEmails}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Check for filter params - if present, show list view with filter
  const draftId = searchParams.get("draftId");
  const templateId = searchParams.get("templateId");
  const noSource = searchParams.get("noSource") === "true";

  const hasFilter = draftId || templateId || noSource;
  const filter: EmailFilter | undefined = hasFilter ? {
    draftId: draftId ?? undefined,
    templateId: templateId ?? undefined,
    noSource: noSource || undefined,
  } : undefined;

  // Get display name for the filter
  const stackAdminApp = useAdminApp();
  const drafts = stackAdminApp.useEmailDrafts();
  const templates = stackAdminApp.useEmailTemplates();

  const filterDisplayName = useMemo(() => {
    if (draftId) {
      const draft = drafts.find((d) => d.id === draftId);
      return draft?.displayName ?? `Draft (${draftId.slice(0, 8)}...)`;
    }
    if (templateId) {
      const template = templates.find((t) => t.id === templateId);
      return template?.displayName ?? `Template (${templateId.slice(0, 8)}...)`;
    }
    if (noSource) {
      return "(No template/draft)";
    }
    return null;
  }, [draftId, templateId, noSource, drafts, templates]);

  const clearFilter = () => {
    router.push("email-sent");
  };

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Sent"
        description="View email logs and domain reputation"
      >
        <div className="flex gap-6">
          {/* Left side: Email Log with toggle above right corner */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              {/* Filter indicator */}
              {hasFilter && filterDisplayName ? (
                <div className="flex items-center gap-2">
                  <Typography className="text-sm text-muted-foreground">
                    Filtering by: <span className="font-medium text-foreground">{filterDisplayName}</span>
                  </Typography>
                  <DesignButton variant="ghost" size="sm" onClick={clearFilter}>
                    <X className="h-4 w-4" />
                  </DesignButton>
                </div>
              ) : (
                <div />
              )}
              {/* Toggle - only show when not filtering */}
              {!hasFilter && (
                <DesignPillToggle
                  options={[...VIEW_MODE_OPTIONS]}
                  selected={viewMode}
                  onSelect={(id) => setViewMode(id as ViewMode)}
                  size="sm"
                  gradient="default"
                />
              )}
            </div>
            <DesignCard
              title="Email Log"
              subtitle={hasFilter ? `Emails from ${filterDisplayName}` : "Manage email sending history"}
              icon={Envelope}
              gradient="default"
              glassmorphic
            >
              {/* Show list view if filtering OR if viewMode is list, otherwise show grouped */}
              {hasFilter || viewMode === "list" ? (
                <EmailSendDataTable filter={filter} />
              ) : (
                <GroupedEmailTable />
              )}
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
