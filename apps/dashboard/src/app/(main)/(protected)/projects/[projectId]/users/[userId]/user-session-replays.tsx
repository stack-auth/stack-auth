"use client";

import { useRouter } from "@/components/router";
import { Input } from "@/components/ui";
import { type DataGridColumnDef, type DataGridSortModel } from "@stackframe/dashboard-ui-components";
import { ServerUser } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";

type AdminSessionReplay = {
  id: string,
  projectUser: {
    id: string,
    displayName: string | null,
    primaryEmail: string | null,
  },
  startedAt: Date,
  lastEventAt: Date,
  chunkCount: number,
  eventCount: number,
};
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminApp } from "../../use-admin-app";
import { UserPageTableSection } from "./user-page-table-section";

const PAGE_SIZE = 50;

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function UserSessionReplaysSection({ user }: { user: ServerUser }) {
  const stackAdminApp = useAdminApp();
  const router = useRouter();

  const [rows, setRows] = useState<AdminSessionReplay[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);

  // Debounce search input → query (server-side).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback(async (cursor: string | null) => {
    const reqId = ++requestIdRef.current;
    if (cursor === null) {
      loadingMoreRef.current = false;
    } else {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setIsLoadingMore(true);
    }
    try {
      const res = await stackAdminApp.listSessionReplays({
        userIds: [user.id],
        limit: PAGE_SIZE,
        cursor: cursor ?? undefined,
        sortDirection,
        query: searchQuery || undefined,
      });
      if (reqId !== requestIdRef.current) return;
      setRows((prev) => (cursor ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
      setError(null);
    } catch (e) {
      if (reqId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load session replays");
    } finally {
      if (reqId === requestIdRef.current && cursor === null) {
        setIsInitialLoading(false);
      }
      if (cursor !== null) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [stackAdminApp, user.id, sortDirection, searchQuery]);

  // Reload on filter/sort changes.
  useEffect(() => {
    setRows([]);
    setNextCursor(null);
    setHasMore(false);
    setIsInitialLoading(true);
    setError(null);
    runAsynchronously(() => fetchPage(null), { noErrorLogging: true });
  }, [fetchPage]);

  const onLoadMore = useCallback(() => {
    if (!nextCursor) return;
    runAsynchronously(() => fetchPage(nextCursor), { noErrorLogging: true });
  }, [fetchPage, nextCursor]);

  const onSortChange = useCallback((model: DataGridSortModel) => {
    const entry = model.find((s) => s.columnId === "lastEventAt");
    setSortDirection(entry?.direction === "asc" ? "asc" : "desc");
  }, []);

  const navigateToReplay = useCallback((replayId: string) => {
    router.push(`/projects/${encodeURIComponent(stackAdminApp.projectId)}/session-replays/${encodeURIComponent(replayId)}`);
  }, [router, stackAdminApp.projectId]);

  const columns = useMemo<DataGridColumnDef<AdminSessionReplay>[]>(() => [
    {
      id: "id",
      accessor: "id",
      header: "Replay ID",
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="block max-w-[220px] truncate font-mono text-xs">{row.id}</span>
      ),
    },
    {
      id: "lastEventAt",
      accessor: "lastEventAt",
      header: "Last activity",
      width: 180,
      sortable: true,
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.lastEventAt.toLocaleString()}</span>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDurationMs(row.lastEventAt.getTime() - row.startedAt.getTime())}
        </span>
      ),
    },
    {
      id: "eventCount",
      accessor: "eventCount",
      header: "Events",
      width: 90,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.eventCount}</span>
      ),
    },
  ], []);

  return (
    <UserPageTableSection
      title="Session Replays"
      urlStateKey="userreplays"
      columns={columns}
      rows={rows}
      getRowId={(replay) => replay.id}
      emptyLabel="No session replays for this user"
      isInitialLoading={isInitialLoading}
      error={error}
      onRowClick={(row) => navigateToReplay(row.id)}
      onSortChange={onSortChange}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onLoadMore={onLoadMore}
      actions={
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search replays..."
          className="h-8 w-56"
        />
      }
    />
  );
}
