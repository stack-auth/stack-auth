"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerTeam } from "@stackframe/stack";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
  type DataGridState,
} from "@stackframe/dashboard-ui-components";
import { useMemo, useState, type ReactNode } from "react";

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
        width: 60,
        renderCell: ({ row }) => action(row),
      },
    ],
    [action],
  );

  const [gridState, setGridState] = useState<DataGridState>(() =>
    createDefaultDataGridState(columns),
  );

  const gridData = useDataSource({
    data: teams,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}

    />
  );
}
