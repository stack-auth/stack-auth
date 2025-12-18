'use client';
import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { ServerUser } from '@stackframe/stack';
import { AvatarCell, DataTableColumnHeader, DataTableManualPagination, SearchToolbarItem, TextCell } from "@/components/ui";
import { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { extendUsers } from "./user-table";

export function TeamMemberSearchTable(props: {
  action: (user: ServerUser) => React.ReactNode,
}) {
  const stackAdminApp = useAdminApp();
  const [filters, setFilters] = useState<Parameters<typeof stackAdminApp.listUsers>[0]>({ limit: 10 });
  const users = extendUsers(stackAdminApp.useUsers(filters));

  const columns: ColumnDef<ServerUser>[] = [
    {
      accessorKey: "profileImageUrl",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Avatar" />,
      cell: ({ row }) => <AvatarCell src={row.original.profileImageUrl || undefined} />,
      enableSorting: false,
    },
    {
      accessorKey: "displayName",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Display Name" />,
      cell: ({ row }) =>  <TextCell size={100}><span className={row.original.displayName === null ? 'text-slate-400' : ''}>{row.original.displayName ?? '–'}</span></TextCell>,
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
      cell: ({ row }) => props.action(row.original),
    },
  ];

  const onUpdate = async (options: {
    cursor: string,
    limit: number,
    sorting: SortingState,
    columnFilters: ColumnFiltersState,
    globalFilters: any,
  }) => {
    let filters: Parameters<typeof stackAdminApp.listUsers>[0] = {
      cursor: options.cursor,
      limit: options.limit,
      query: options.globalFilters,
    };

    setFilters(filters);
    const users = await stackAdminApp.listUsers(filters);
    return { nextCursor: users.nextCursor };
  };

  return <DataTableManualPagination
    showDefaultToolbar={false}
    columns={columns}
    data={users}
    onUpdate={onUpdate}
    toolbarRender={table => <SearchToolbarItem table={table} placeholder="Search table" className="w-full" />}
    defaultColumnFilters={[]}
    defaultSorting={[]}
  />;
}
