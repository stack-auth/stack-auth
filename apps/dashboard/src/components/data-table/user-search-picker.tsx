'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { Input, Skeleton } from "@/components/ui";
import { ServerUser } from '@stackframe/stack';
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
} from "@stackframe/dashboard-ui-components";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { extendUsers } from "./user-table";

const SEARCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 5;

function UserSearchTable(props: {
  query: string,
  action: (user: ServerUser) => React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const [filters, setFilters] = useState<Parameters<typeof stackAdminApp.listUsers>[0]>({
    limit: PAGE_SIZE,
    query: props.query || undefined,
  });

  useEffect(() => {
    setFilters({ limit: PAGE_SIZE, query: props.query || undefined });
  }, [props.query]);

  const users = extendUsers(stackAdminApp.useUsers(filters));

  const { action } = props;
  const columns: DataGridColumnDef<ServerUser>[] = useMemo(() => [
    {
      id: "displayName",
      header: "Display Name",
      accessor: "displayName",
      width: 100,
      flex: 1,
      type: "string",
      sortable: false,
      renderCell: ({ row }) => (
        <span className={row.displayName == null ? "text-slate-400" : ""}>
          {row.displayName ?? "–"}
        </span>
      ),
    },
    {
      id: "primaryEmail",
      header: "Primary Email",
      accessor: "primaryEmail",
      width: 150,
      type: "string",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="truncate">{row.primaryEmail}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: 90,
      minWidth: 90,
      maxWidth: 90,
      sortable: false,
      hideable: false,
      resizable: false,
      renderCell: ({ row }) => action(row),
    },
  ], [action]);

  const [gridState, setGridState] = useState(() => createDefaultDataGridState(columns));

  const gridData = useDataSource({
    data: users,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  return (
    <DataGrid<ServerUser>
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      maxHeight={280}
      toolbar={false}
      footer={false}
    />
  );
}

export function UserSearchPicker(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  return (
    <div className="space-y-3 pt-2">
      <Input
        placeholder="Search users..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="h-8 text-xs"
      />
      <Suspense fallback={<div className="space-y-2 p-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}>
        <UserSearchTable query={debouncedQuery} action={props.action} />
      </Suspense>
    </div>
  );
}
