'use client';
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableFacetedFilter, DateCell, SearchToolbarItem, TextCell, standardFilterFn } from "@/components/ui";
import { InternalApiKey } from '@stackframe/stack';
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useMemo, useState } from "react";

type ExtendedInternalApiKey = InternalApiKey & {
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
  apiKey: ExtendedInternalApiKey,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const clientKeyText = props.apiKey.publishableClientKey?.lastFour
    ? `client key *****${props.apiKey.publishableClientKey.lastFour}`
    : null;
  const serverKeyText = props.apiKey.secretServerKey?.lastFour
    ? `server key *****${props.apiKey.secretServerKey.lastFour}`
    : null;
  const keysText = [clientKeyText, serverKeyText].filter(Boolean).join(" and ");
  const confirmText = keysText
    ? `Are you sure you want to revoke ${keysText}?`
    : "Are you sure you want to revoke this API key?";

  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Revoke API Key"
    danger
    cancelButton
    okButton={{ label: "Revoke Key", onClick: async () => { await props.apiKey.revoke(); } }}
    confirmText="I understand this will unlink all the apps using this API key"
  >
    {confirmText}
  </ActionDialog>;
}

function Actions({ row }: { row: Row<ExtendedInternalApiKey> }) {
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

const getColumns = (showPublishableClientKey: boolean): ColumnDef<ExtendedInternalApiKey>[] => {
  const baseColumns: ColumnDef<ExtendedInternalApiKey>[] = [
    {
      accessorKey: "description",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Description" />,
      cell: ({ row }) => <TextCell size={300}>{row.original.description}</TextCell>,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
      cell: ({ row }) => <BadgeCell badges={[row.original.status]} />,
      filterFn: standardFilterFn,
    },
  ];
  const clientKeyColumn: ColumnDef<ExtendedInternalApiKey> = {
    id: "clientKey",
    accessorFn: (row) => row.publishableClientKey?.lastFour,
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Client Key" />,
    cell: ({ row }) => (
      <TextCell>{row.original.publishableClientKey?.lastFour ? `*******${row.original.publishableClientKey.lastFour}` : "—"}</TextCell>
    ),
    enableSorting: false,
  };
  const serverKeyColumn: ColumnDef<ExtendedInternalApiKey> = {
    id: "serverKey",
    accessorFn: (row) => row.secretServerKey?.lastFour,
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Server Key" />,
    cell: ({ row }) => <TextCell>{row.original.secretServerKey?.lastFour ? `*******${row.original.secretServerKey.lastFour}` : "—"}</TextCell>,
    enableSorting: false,
  };
  const tailColumns: ColumnDef<ExtendedInternalApiKey>[] = [
    {
      accessorKey: "expiresAt",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Expires At" />,
      cell: ({ row }) => <DateCell date={row.original.expiresAt} ignoreAfterYears={50} />,
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Created At" />,
      cell: ({ row }) => <DateCell date={row.original.createdAt} ignoreAfterYears={50} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <Actions row={row} />,
    },
  ];

  return showPublishableClientKey
    ? [...baseColumns, clientKeyColumn, serverKeyColumn, ...tailColumns]
    : [...baseColumns, serverKeyColumn, ...tailColumns];
};

export function InternalApiKeyTable(props: { apiKeys: InternalApiKey[], showPublishableClientKey?: boolean }) {
  const showPublishableClientKey = props.showPublishableClientKey ?? true;
  const extendedApiKeys = useMemo(() => {
    const keys = props.apiKeys.map((apiKey) => ({
      ...apiKey,
      status: ({ 'valid': 'valid', 'manually-revoked': 'revoked', 'expired': 'expired' } as const)[apiKey.whyInvalid() || 'valid'],
    } satisfies ExtendedInternalApiKey));
    // first sort based on status, then by createdAt
    return keys.sort((a, b) => {
      if (a.status === b.status) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.status === 'valid' ? -1 : 1;
    });
  }, [props.apiKeys]);

  const columns = useMemo(() => getColumns(showPublishableClientKey), [showPublishableClientKey]);

  return <DataTable
    data={extendedApiKeys}
    columns={columns}
    toolbarRender={toolbarRender}
    defaultColumnFilters={[{ id: 'status', value: ['valid'] }]}
    defaultSorting={[]}
  />;
}
