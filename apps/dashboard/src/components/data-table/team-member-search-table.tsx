'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui";
import type { ServerUser } from '@stackframe/stack';
import {
  createDefaultDataGridState,
  DataGrid,
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extendUsers } from "./user-table";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export function TeamMemberSearchTable(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const actionRef = useRef(props.action);
  actionRef.current = props.action;

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ServerUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const hasDataRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (hasDataRef.current) {
      setIsRefetching(true);
    } else {
      setIsLoading(true);
    }

    runAsynchronouslyWithAlert(async () => {
      try {
        const result = await stackAdminApp.listUsers({
          limit: PAGE_SIZE,
          query: search || undefined,
        });
        if (controller.signal.aborted) return;
        setRows(extendUsers(result));
        setNextCursor(result.nextCursor);
        hasDataRef.current = true;
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsRefetching(false);
        }
      }
    });

    return () => controller.abort();
  }, [search, stackAdminApp]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    const activeSearch = search;
    const activeCursor = nextCursor;
    try {
      const result = await stackAdminApp.listUsers({
        limit: PAGE_SIZE,
        query: activeSearch || undefined,
        cursor: activeCursor,
      });
      if (search !== activeSearch || abortRef.current?.signal.aborted) return;
      setRows((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const newRows = extendUsers(result).filter((r) => !existingIds.has(r.id));
        return [...prev, ...newRows];
      });
      setNextCursor(result.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore, search, stackAdminApp]);

  const columns = useMemo<DataGridColumnDef<ServerUser>[]>(() => [
    {
      id: "avatar",
      header: "",
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      sortable: false,
      hideable: false,
      resizable: false,
      renderCell: ({ row }) => (
        <Avatar className="h-8 w-8">
          <AvatarImage src={row.profileImageUrl ?? undefined} />
          <AvatarFallback className="text-xs">
            {row.displayName?.charAt(0) ?? row.primaryEmail?.charAt(0) ?? "?"}
          </AvatarFallback>
        </Avatar>
      ),
    },
    {
      id: "displayName",
      header: "Display Name",
      accessor: "displayName",
      width: 150,
      flex: 1,
      sortable: false,
      type: "string",
      renderCell: ({ row }) => (
        <span className={row.displayName == null ? 'text-muted-foreground' : ''}>
          {row.displayName ?? '–'}
        </span>
      ),
    },
    {
      id: "primaryEmail",
      header: "Email",
      accessor: "primaryEmail",
      width: 200,
      flex: 1,
      sortable: false,
      type: "string",
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.primaryEmail ?? '–'}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: 100,
      sortable: false,
      hideable: false,
      resizable: false,
      renderCell: ({ row }) => actionRef.current(row),
    },
  ], []);

  const [gridState, setGridState] = useState<DataGridState>(() =>
    createDefaultDataGridState(columns)
  );

  const trimmedQuickSearch = gridState.quickSearch.trim();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch((prev) => (prev === trimmedQuickSearch ? prev : trimmedQuickSearch));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [trimmedQuickSearch]);

  const handleLoadMore = useCallback(() => {
    runAsynchronouslyWithAlert(loadMore);
  }, [loadMore]);

  return (
    <DataGrid
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      isLoading={isLoading}
      isRefetching={isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={nextCursor != null}
      isLoadingMore={isLoadingMore}
      onLoadMore={handleLoadMore}
      footer={false}

      emptyState={
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No users found</p>
        </div>
      }
    />
  );
}
