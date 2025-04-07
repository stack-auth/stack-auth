'use client';
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableFacetedFilter, DateCell, SearchToolbarItem, TextCell, standardFilterFn } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { ApiKey } from "../lib/stack-app/api-keys";

type ExtendedApiKey = ApiKey & {
  status: 'valid' | 'expired' | 'revoked',
};

function toolbarRender<TData>(table: Table<TData>) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder="Search table" />
      <DataTableFacetedFilter
        column={table.getColumn("status")}
        title="Status"
        options={['valid', 'expired', 'revoked'].map((provider) => ({
          value: provider,
          label: provider,
        }))}
      />
    </>
  );
}

function RevokeDialog(props: {
  apiKey: ExtendedApiKey,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Revoke API Key"
    danger
    cancelButton
    okButton={{ label: "Revoke Key", onClick: async () => { await props.apiKey.revoke(); } }}
    confirmText="I understand this will unlink all the apps using this API key"
  >
    {`Are you sure you want to revoke API key *****${props.apiKey.value.lastFour}?`}
  </ActionDialog>;
}

function Actions({ row }: { row: Row<ExtendedApiKey> }) {
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  return (
    <>
      <RevokeDialog apiKey={row.original} open={isRevokeModalOpen} onOpenChange={setIsRevokeModalOpen} />
      <ActionCell
        invisible={row.original.status !== 'valid'}
        items={[{
          item: "Revoke",
          danger: true,
          onClick: () => setIsRevokeModalOpen(true),
        }]}
      />
    </>
  );
}

const columns: ColumnDef<ExtendedApiKey>[] =  [
  {
    accessorKey: "description",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Description" />,
    cell: ({ row }) => <TextCell size={100}>{row.original.description}</TextCell>,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
    cell: ({ row }) => <BadgeCell badges={[row.original.status]} />,
    filterFn: standardFilterFn,
  },
  {
    id: "value",
    accessorFn: (row) => row.value.lastFour,
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Client Key" />,
    cell: ({ row }) => <TextCell>*******{row.original.value.lastFour}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "expiresAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Expires At" />,
    cell: ({ row }) => {
      if (row.original.status === 'revoked') return <TextCell>-</TextCell>;
      return row.original.expiresAt ? <DateCell date={row.original.expiresAt} ignoreAfterYears={50} /> : <TextCell>Never</TextCell>;
    },
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Created At" />,
    cell: ({ row }) => <DateCell date={row.original.createdAt} ignoreAfterYears={50} />
  },
  {
    id: "actions",
    cell: ({ row }) => <Actions row={row} />,
  },
];

export function ApiKeyTable(props: { apiKeys: ApiKey[] }) {
  const extendedApiKeys = useMemo(() => {
    const keys = props.apiKeys.map((apiKey) => ({
      ...apiKey,
      status: ({ 'valid': 'valid', 'manually-revoked': 'revoked', 'expired': 'expired' } as const)[apiKey.whyInvalid() || 'valid'],
    } satisfies ExtendedApiKey));
    // first sort based on status, then by createdAt
    return keys.sort((a, b) => {
      if (a.status === b.status) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.status === 'valid' ? -1 : 1;
    });
  }, [props.apiKeys]);

  return <DataTable
    data={extendedApiKeys}
    columns={columns}
    toolbarRender={toolbarRender}
    defaultColumnFilters={[]}
    defaultSorting={[]}
  />;
}
