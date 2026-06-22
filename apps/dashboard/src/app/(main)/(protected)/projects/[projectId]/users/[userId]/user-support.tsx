"use client";

import { DesignBadge } from "@/components/design-components";
import { useRouter } from "@/components/router";
import { listConversations } from "@/lib/conversations";
import type { DesignBadgeColor } from "@hexclave/dashboard-ui-components";
import type { DataGridColumnDef } from "@hexclave/dashboard-ui-components";
import type { ServerUser } from "@hexclave/next";
import { useUser } from "@hexclave/next";
import type { ConversationListResponse } from "@hexclave/shared/dist/interface/conversations";
import { fromNow } from "@hexclave/shared/dist/utils/dates";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { useEffect, useMemo, useState } from "react";
import { useProjectId } from "../../use-admin-app";
import { UserPageTableSection } from "./user-page-table-section";

type ConversationRow = ConversationListResponse["conversations"][number];

const STATUS_COLOR: Record<string, DesignBadgeColor> = {
  open: "green",
  pending: "orange",
  closed: "cyan",
};

export function UserSupportSection({ user }: { user: ServerUser }) {
  const projectId = useProjectId();
  const currentUser = useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const router = useRouter();

  const [rows, setRows] = useState<readonly ConversationRow[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsInitialLoading(true);
    setError(null);
    runAsynchronouslyWithAlert(async () => {
      try {
        const result = await listConversations(currentUser, { projectId, userId: user.id, limit: 100 });
        if (!cancelled) setRows(result.conversations);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load support conversations.");
      } finally {
        if (!cancelled) setIsInitialLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentUser, projectId, user.id]);

  const columns = useMemo<DataGridColumnDef<ConversationRow>[]>(() => [
    {
      id: "subject",
      header: "Subject",
      flex: 1,
      minWidth: 160,
      sortable: false,
      renderCell: ({ row }) => <span className="truncate">{row.subject}</span>,
    },
    {
      id: "status",
      header: "Status",
      width: 96,
      sortable: false,
      renderCell: ({ row }) => (
        <DesignBadge label={row.status} color={STATUS_COLOR[row.status] ?? "blue"} size="sm" />
      ),
    },
    {
      id: "priority",
      header: "Priority",
      width: 96,
      sortable: false,
      renderCell: ({ row }) => <span className="text-sm capitalize text-muted-foreground">{row.priority}</span>,
    },
    {
      id: "lastActivity",
      header: "Last activity",
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{fromNow(new Date(row.lastActivityAt))}</span>
      ),
    },
  ], []);

  return (
    <UserPageTableSection
      title="Support conversations"
      urlStateKey="usersupport"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.conversationId}
      emptyLabel="No support conversations for this user."
      isInitialLoading={isInitialLoading}
      error={error}
      onRowClick={(row) => {
        router.push(urlString`/projects/${projectId}/conversations?conversationId=${row.conversationId}&userId=${user.id}`);
      }}
    />
  );
}
