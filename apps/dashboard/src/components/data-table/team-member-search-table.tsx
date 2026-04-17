// TODO(ui-fixes-minor): URL-synced search state was dropped in the DataGrid
// migration — the debounced search routes to the server but the current
// query is no longer reflected in the URL. Restore via `useUrlQueryState`
// when product is ready to treat this as a regression.
'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui";
import type { ServerUser } from '@stackframe/stack';
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { extendUsers } from "./user-table";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export function TeamMemberSearchTable(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const actionRef = useRef(props.action);
  actionRef.current = props.action;

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

  // Debounce the toolbar search so we don't hit `listUsers` on every keystroke.
  const [debouncedQuickSearch] = useDebounce(gridState.quickSearch.trim(), SEARCH_DEBOUNCE_MS);

  // Server-side infinite data source. Identity is stable (no closure state
  // beyond `stackAdminApp`) so refetches are driven purely by the debounced
  // `quickSearch` key inside `useDataSource`.
  const dataSource = useMemo<DataGridDataSource<ServerUser>>(
    () => async function* (params) {
      const query = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = await stackAdminApp.listUsers({
        limit: PAGE_SIZE,
        query,
        cursor,
      });
      yield {
        rows: extendUsers(result),
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [stackAdminApp],
  );

  const getRowId = useCallback((row: ServerUser) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: debouncedQuickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={getRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}
      emptyState={
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No users found</p>
        </div>
      }
    />
  );
}
