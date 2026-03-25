'use client';

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ServerTeam } from "@stackframe/stack";
import {
  DataTable,
  DataTableColumnHeader,
  SearchToolbarItem,
  TextCell,
} from "@/components/ui";
import { ColumnDef, Table } from "@tanstack/react-table";
import { useMemo } from "react";

function toolbarRender<TData>(table: Table<TData>) {
  return (
    <SearchToolbarItem
      table={table}
      keyName="displayName"
      placeholder="Search teams"
      className="w-full"
    />
  );
}

export function TeamSearchTable(props: {
  action: (team: ServerTeam) => React.ReactNode,
}) {
  const adminApp = useAdminApp();
  const teams = adminApp.useTeams();

  const tableColumns = useMemo<ColumnDef<ServerTeam>[]>(() => [
    {
      accessorKey: "displayName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} columnTitle="Display Name" />
      ),
      cell: ({ row }) => (
        <TextCell size={180}>{row.original.displayName}</TextCell>
      ),
      enableSorting: false,
    },
    {
      accessorKey: "id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} columnTitle="Team ID" />
      ),
      cell: ({ row }) => (
        <TextCell size={150}>
          <span className="font-mono text-xs">{row.original.id}</span>
        </TextCell>
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      cell: ({ row }) => props.action(row.original),
      enableSorting: false,
    },
  ], [props]);

  return (
    <DataTable
      data={teams}
      columns={tableColumns}
      toolbarRender={toolbarRender}
      showDefaultToolbar={false}
      defaultColumnFilters={[]}
      defaultSorting={[]}
    />
  );
}
