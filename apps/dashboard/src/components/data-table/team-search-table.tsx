"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerTeam } from "@hexclave/next";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

const PAGE_SIZE = 25;

export function TeamSearchTable(props: {
  action: (team: ServerTeam) => ReactNode,
}) {
  const { action } = props;
  const adminApp = useAdminApp();
  const teams = adminApp.useTeams();

  const columns = useMemo<DataGridColumnDef<ServerTeam>[]>(
    () => [
      {
        id: "displayName",
        header: "Display Name",
        accessor: "displayName",
        width: 200,
        flex: 1,
        type: "string",
        sortable: false,
      },
      {
        id: "id",
        header: "Team ID",
        accessor: "id",
        width: 160,
        type: "string",
        sortable: false,
        renderCell: ({ value }) => (
          <span className="font-mono text-xs">{String(value)}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        sortable: false,
        hideable: false,
        resizable: false,
        width: 96,
        align: "right",
        renderCell: ({ row }) => action(row),
      },
    ],
    [action],
  );

  const [gridState, setGridState] = useState<DataGridState>(() =>
    createDefaultDataGridState(columns),
  );
  const [loadedCount, setLoadedCount] = useState(PAGE_SIZE);

  // Reset visible window whenever the search/sort changes so the user
  // doesn't have to scroll back through stale rows.
  useEffect(() => {
    setLoadedCount(PAGE_SIZE);
  }, [gridState.quickSearch, gridState.sorting]);

  // Pull the full filtered+sorted result, then slice locally for infinite scroll.
  const gridData = useDataSource({
    data: teams,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER },
    paginationMode: "client",
  });

  const visibleRows = useMemo(
    () => gridData.rows.slice(0, loadedCount),
    [gridData.rows, loadedCount],
  );
  const hasMore = loadedCount < gridData.rows.length;
  const loadMore = useCallback(() => {
    setLoadedCount((c) => c + PAGE_SIZE);
  }, []);

  return (
    <DataGrid
      columns={columns}
      rows={visibleRows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      state={gridState}
      onChange={setGridState}
      fillHeight={false}
      maxHeight={420}
      paginationMode="infinite"
      hasMore={hasMore}
      onLoadMore={loadMore}
    />
  );
}
