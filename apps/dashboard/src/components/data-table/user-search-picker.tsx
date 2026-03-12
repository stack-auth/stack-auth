'use client';
import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { DataTableColumnHeader, DataTableManualPagination, Input, Skeleton, TextCell } from "@/components/ui";
import { ServerUser } from '@stackframe/stack';
import { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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

  // Reset filters when query changes
  useEffect(() => {
    setFilters({ limit: PAGE_SIZE, query: props.query || undefined });
  }, [props.query]);

  const users = extendUsers(stackAdminApp.useUsers(filters));

  const { action } = props;
  const columns: ColumnDef<ServerUser>[] = useMemo(() => [
    {
      accessorKey: "displayName",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Display Name" />,
      cell: ({ row }) => <TextCell size={100}><span className={row.original.displayName === null ? 'text-slate-400' : ''}>{row.original.displayName ?? '–'}</span></TextCell>,
      enableSorting: false,
    },
    {
      accessorKey: "primaryEmail",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Primary Email" />,
      cell: ({ row }) => <TextCell size={150}>{row.original.primaryEmail}</TextCell>,
      enableSorting: false,
    },
    {
      id: "actions",
      cell: ({ row }) => action(row.original),
    },
  ], [action]);

  const onUpdate = useCallback(async (options: {
    cursor: string,
    limit: number,
    sorting: SortingState,
    columnFilters: ColumnFiltersState,
    globalFilters: any,
  }) => {
    const newFilters: Parameters<typeof stackAdminApp.listUsers>[0] = {
      cursor: options.cursor,
      limit: options.limit,
      query: props.query || undefined,
    };

    setFilters(newFilters);
    const result = await stackAdminApp.listUsers(newFilters);
    return { nextCursor: result.nextCursor };
  }, [stackAdminApp, props.query]);

  return <DataTableManualPagination
    showDefaultToolbar={false}
    columns={columns}
    data={users}
    onUpdate={onUpdate}
    defaultColumnFilters={[]}
    defaultSorting={[]}
  />;
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
