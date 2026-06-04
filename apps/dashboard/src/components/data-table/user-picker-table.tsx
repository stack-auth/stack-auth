// TODO(ui-fixes-minor): URL-synced search state was dropped in the DataGrid
// migration — the debounced search routes to the server but the current
// query is no longer reflected in the URL. Restore via `useUrlQueryState`
// when product is ready to treat this as a regression.
'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui";
import type { ServerUser } from '@hexclave/next';
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
  type DataGridState,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { extendUsers } from "./user-table";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export function UserPickerTable(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const hexclaveAdminApp = useAdminApp();
  const actionRef = useRef(props.action);
  actionRef.current = props.action;

  const columns = useMemo<DataGridColumnDef<ServerUser>[]>(() => [
    {
      id: "avatar",
      header: "",
      width: 56,
      minWidth: 56,
      maxWidth: 56,
      align: "center",
      sortable: false,
      hideable: false,
      resizable: false,
      renderCell: ({ row }) => (
        <Avatar className="h-7 w-7">
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
      width: 140,
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
      width: 160,
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
      minWidth: 100,
      maxWidth: 100,
      align: "right",
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

  const dataSource = useMemo<DataGridDataSource<ServerUser>>(
    () => async function* (params) {
      const query = typeof params.quickSearch === "string" && params.quickSearch.trim().length > 0
        ? params.quickSearch.trim()
        : undefined;
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = await hexclaveAdminApp.listUsers({
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
    [hexclaveAdminApp],
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
      fillHeight={false}
      maxHeight={420}
      footer={false}
      emptyState={
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No users found</p>
        </div>
      }
    />
  );
}
