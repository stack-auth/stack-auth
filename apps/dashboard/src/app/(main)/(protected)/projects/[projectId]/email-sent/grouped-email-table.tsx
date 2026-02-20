"use client";

import { DesignDataTable } from "@/components/design-components/table";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { AdminEmailOutbox, AdminEmailOutboxStatus } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useMemo, useState } from "react";
import { useAdminApp } from "../use-admin-app";
import { StatsBar, StatsBarData } from "./stats-bar";

type GroupedEmailRow = {
  // Unique key for the group
  groupKey: string,
  // Display name for the template/draft
  displayName: string,
  // Type of source
  sourceType: "draft" | "template" | "none",
  // ID of the source (draft or template)
  sourceId: string | null,
  // Number of recipients (emails) in this group
  recipientCount: number,
  // Stats for the bar
  stats: StatsBarData,
};

// Map status to stats category
function getStatsCategory(status: AdminEmailOutboxStatus): keyof StatsBarData {
  switch (status) {
    case "sent":
    case "opened":
    case "clicked":
    case "delivery-delayed":
    case "skipped": {
      return "sent";
    }
    case "bounced": {
      return "bounced";
    }
    case "marked-as-spam": {
      return "spam";
    }
    case "render-error":
    case "server-error": {
      return "errors";
    }
    case "paused":
    case "preparing":
    case "rendering":
    case "scheduled":
    case "queued":
    case "sending": {
      return "inProgress";
    }
    default: {
      return "inProgress";
    }
  }
}

function groupEmails(
  emails: AdminEmailOutbox[],
  drafts: Map<string, string>,
  templates: Map<string, string>
): GroupedEmailRow[] {
  // Group emails by their source
  const groups = new Map<string, {
    displayName: string,
    sourceType: "draft" | "template" | "none",
    sourceId: string | null,
    emails: AdminEmailOutbox[],
  }>();

  for (const email of emails) {
    let groupKey: string;
    let displayName: string;
    let sourceType: "draft" | "template" | "none";
    let sourceId: string | null;

    if (email.createdWith === "draft" && email.emailDraftId) {
      groupKey = `draft:${email.emailDraftId}`;
      displayName = drafts.get(email.emailDraftId) ?? `Draft (${email.emailDraftId.slice(0, 8)}...)`;
      sourceType = "draft";
      sourceId = email.emailDraftId;
    } else if (email.createdWith === "programmatic-call" && email.emailProgrammaticCallTemplateId) {
      groupKey = `template:${email.emailProgrammaticCallTemplateId}`;
      displayName = templates.get(email.emailProgrammaticCallTemplateId) ?? `Template (${email.emailProgrammaticCallTemplateId.slice(0, 8)}...)`;
      sourceType = "template";
      sourceId = email.emailProgrammaticCallTemplateId;
    } else {
      groupKey = "none";
      displayName = "(No template/draft)";
      sourceType = "none";
      sourceId = null;
    }

    const existing = groups.get(groupKey);
    if (existing) {
      existing.emails.push(email);
    } else {
      groups.set(groupKey, {
        displayName,
        sourceType,
        sourceId,
        emails: [email],
      });
    }
  }

  // Convert to rows with stats
  const rows: GroupedEmailRow[] = [];
  for (const [groupKey, group] of groups) {
    const stats: StatsBarData = {
      sent: 0,
      bounced: 0,
      spam: 0,
      errors: 0,
      inProgress: 0,
    };

    for (const email of group.emails) {
      const category = getStatsCategory(email.status);
      stats[category]++;
    }

    rows.push({
      groupKey,
      displayName: group.displayName,
      sourceType: group.sourceType,
      sourceId: group.sourceId,
      recipientCount: group.emails.length,
      stats,
    });
  }

  // Sort by recipient count descending
  rows.sort((a, b) => b.recipientCount - a.recipientCount);

  return rows;
}

const groupedTableColumns: ColumnDef<GroupedEmailRow>[] = [
  {
    accessorKey: "displayName",
    header: "Template/Draft",
    cell: ({ row }) => (
      <div className="font-medium">{row.original.displayName}</div>
    ),
  },
  {
    accessorKey: "recipientCount",
    header: "Recipients",
    cell: ({ row }) => (
      <div className="text-sm">{row.original.recipientCount.toLocaleString()}</div>
    ),
  },
  {
    accessorKey: "stats",
    header: "Stats",
    cell: ({ row }) => (
      <div className="w-48">
        <StatsBar data={row.original.stats} />
      </div>
    ),
  },
];

export function GroupedEmailTable() {
  const stackAdminApp = useAdminApp();
  const router = useRouter();
  const [emails, setEmails] = useState<AdminEmailOutbox[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch drafts and templates for display names
  const drafts = stackAdminApp.useEmailDrafts();
  const templates = stackAdminApp.useEmailTemplates();

  // Create maps for quick lookup
  const draftsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const draft of drafts) {
      map.set(draft.id, draft.displayName);
    }
    return map;
  }, [drafts]);

  const templatesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const template of templates) {
      map.set(template.id, template.displayName);
    }
    return map;
  }, [templates]);

  // Fetch all emails
  useEffect(() => {
    runAsynchronously(async () => {
      setLoading(true);
      try {
        // Fetch all emails - TODO: Add pagination if needed for large datasets
        const result = await stackAdminApp.listOutboxEmails();
        setEmails(result.items);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  // Group emails by template/draft
  const groupedRows = useMemo(
    () => groupEmails(emails, draftsMap, templatesMap),
    [emails, draftsMap, templatesMap]
  );

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
      data={groupedRows}
      defaultColumnFilters={[]}
      columns={groupedTableColumns}
      defaultSorting={[{ id: "recipientCount", desc: true }]}
      onRowClick={(row) => {
        // Navigate to list view filtered by this template/draft
        if (row.sourceType === "draft" && row.sourceId) {
          router.push(`email-sent?draftId=${row.sourceId}`);
        } else if (row.sourceType === "template" && row.sourceId) {
          router.push(`email-sent?templateId=${row.sourceId}`);
        } else {
          router.push(`email-sent?noSource=true`);
        }
      }}
    />
  );
}
