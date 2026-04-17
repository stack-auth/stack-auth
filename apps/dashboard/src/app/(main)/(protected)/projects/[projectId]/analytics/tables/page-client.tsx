"use client";

import { Link } from "@/components/link";
import { Button, Typography } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ArrowClockwiseIcon, CodeIcon } from "@phosphor-icons/react";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { useCallback, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { AnalyticsEventLimitBanner } from "../shared";
import { AiQueryBar } from "./ai-query-bar";
import { AiQueryDialog } from "./ai-query-dialog";
import {
  QueryDataGrid,
  type QueryDataGridMode,
} from "./query-data-grid";
import { useAiQueryChat } from "./use-ai-query-chat";

// ─── Available tables ───────────────────────────────────────────────

type TableConfig = {
  displayName: string,
  baseQuery: string,
  defaultOrderBy: string,
  defaultOrderDir: "asc" | "desc",
};

type TableId = string;

const AVAILABLE_TABLES = new Map<TableId, TableConfig>([
  [
    "events",
    {
      displayName: "Events",
      baseQuery: "SELECT * FROM default.events",
      defaultOrderBy: "event_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "users",
    {
      displayName: "Users",
      baseQuery: "SELECT * FROM default.users",
      defaultOrderBy: "signed_up_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "contact_channels",
    {
      displayName: "Contact Channels",
      baseQuery: "SELECT * FROM default.contact_channels",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "teams",
    {
      displayName: "Teams",
      baseQuery: "SELECT * FROM default.teams",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "team_member_profiles",
    {
      displayName: "Team Member Profiles",
      baseQuery: "SELECT * FROM default.team_member_profiles",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "team_permissions",
    {
      displayName: "Team Permissions",
      baseQuery: "SELECT * FROM default.team_permissions",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "team_invitations",
    {
      displayName: "Team Invitations",
      baseQuery: "SELECT * FROM default.team_invitations",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "email_outboxes",
    {
      displayName: "Email Outboxes",
      baseQuery: "SELECT * FROM default.email_outboxes",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "project_permissions",
    {
      displayName: "Project Permissions",
      baseQuery: "SELECT * FROM default.project_permissions",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "notification_preferences",
    {
      displayName: "Notification Preferences",
      baseQuery: "SELECT * FROM default.notification_preferences",
      defaultOrderBy: "user_id",
      defaultOrderDir: "desc",
    },
  ],
  [
    "refresh_tokens",
    {
      displayName: "Refresh Tokens",
      baseQuery: "SELECT * FROM default.refresh_tokens",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
  [
    "connected_accounts",
    {
      displayName: "Connected Accounts",
      baseQuery: "SELECT * FROM default.connected_accounts",
      defaultOrderBy: "created_at",
      defaultOrderDir: "desc",
    },
  ],
]);

// ─── Per-table content ──────────────────────────────────────────────

function TableContent({ tableId }: { tableId: TableId }) {
  const tableConfig = AVAILABLE_TABLES.get(tableId) ?? throwErr(`Unknown analytics table: ${tableId}`);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Shared AI chat state — feeds both the search bar and the eye
  // dialog, so they operate on a single conversation thread.
  const chat = useAiQueryChat();

  const aiQuery = chat.latestQuery;
  const isAiActive = aiQuery != null;

  // When the AI has committed a query, it becomes the source of
  // truth; otherwise fall back to the table's own default query.
  const effectiveQuery = aiQuery ?? tableConfig.baseQuery;
  const effectiveMode: QueryDataGridMode = isAiActive ? "one-shot" : "paginated";

  // Default sort / search only apply while the AI is inactive — an
  // AI-generated aggregate won't have an `event_at` column to sort on.
  const defaultOrderBy = isAiActive ? undefined : tableConfig.defaultOrderBy;
  const defaultOrderDir = isAiActive ? undefined : tableConfig.defaultOrderDir;

  const handleResetChat = useCallback(() => {
    chat.setMessages([]);
  }, [chat]);

  const aiSearchBar = (
    <AiQueryBar
      chat={chat}
      isActive={isAiActive}
      onOpenDialog={() => setDialogOpen(true)}
      onReset={handleResetChat}
    />
  );

  const renderToolbarExtra = useCallback(
    (ctx: { rowCount: number, hasMore: boolean, reload: () => void }) => (
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={ctx.reload}
          className="h-7 w-7"
          title="Refresh"
        >
          <ArrowClockwiseIcon className="h-3.5 w-3.5" />
        </Button>
        <span className="hidden sm:inline px-1 text-[11px] tabular-nums text-muted-foreground">
          {ctx.hasMore
            ? `${ctx.rowCount.toLocaleString()}+ rows`
            : `${ctx.rowCount.toLocaleString()} rows`}
        </span>
      </div>
    ),
    [],
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <QueryDataGrid
        query={effectiveQuery}
        mode={effectiveMode}
        defaultOrderBy={defaultOrderBy}
        defaultOrderDir={defaultOrderDir}
        enableQuickSearchFilter={!isAiActive}
        searchBar={aiSearchBar}
        toolbarExtra={renderToolbarExtra}
        exportFilename={`${tableId}-export`}
      />

      <AiQueryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        chat={chat}
        currentQuery={aiQuery}
      />
    </div>
  );
}

export default function PageClient() {
  const [selectedTable, setSelectedTable] = useState<TableId | null>("events");

  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth noPadding>
        <AnalyticsEventLimitBanner />
        <div className="flex h-[calc(100vh-4.5rem)] max-h-[calc(100vh-4.5rem)] flex-1 min-h-0 overflow-hidden lg:-mx-2 dark:h-full dark:max-h-full">
          {/* Left sidebar — hidden on mobile */}
          <div className="hidden lg:flex h-full w-48 flex-shrink-0 flex-col overflow-hidden border-r border-border/50 pl-2">
            <div className="flex-1 overflow-auto px-4 py-4">
              <Typography className="px-3 mb-3 text-xs font-semibold uppercase tracking-wide text-foreground/70">
                Tables
              </Typography>
              <div className="space-y-1">
                {[...AVAILABLE_TABLES.entries()].map(([id, config]) => (
                  <button
                    key={id}
                    onClick={() => setSelectedTable(id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:transition-none",
                      selectedTable === id
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {config.displayName}
                  </button>
                ))}
              </div>
            </div>
            <div className="py-4 px-4">
              <Link
                href="./queries"
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors hover:transition-none w-full"
              >
                <CodeIcon className="h-4 w-4" />
                Queries
              </Link>
            </div>
          </div>

          {/* Right content */}
          <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
            {selectedTable ? (
              <TableContent key={selectedTable} tableId={selectedTable} />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Typography variant="secondary">
                  Select a table to view its contents
                </Typography>
              </div>
            )}
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
