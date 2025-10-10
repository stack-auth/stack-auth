'use client';
import { InternalApiKey } from '@stackframe/stack';
import { ActionCell, ActionDialog, BadgeCell, DataTable, DataTableColumnHeader, DataTableFacetedFilter, DataTableI18n, DateCell, SearchToolbarItem, TextCell, standardFilterFn } from "@stackframe/stack-ui";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useTranslations } from 'next-intl';
import { useMemo, useState } from "react";

type ExtendedInternalApiKey = InternalApiKey & {
  status: 'valid' | 'expired' | 'revoked',
};

function toolbarRender<TData>(table: Table<TData>, searchPlaceholder: string, statusTitle: string, statusOptions: { value: string, label: string }[]) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder={searchPlaceholder} />
      <DataTableFacetedFilter
        column={table.getColumn("status")}
        title={statusTitle}
        options={statusOptions}
      />
    </>
  );
}

function RevokeDialog(props: {
  apiKey: ExtendedInternalApiKey,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const t = useTranslations('apiKeys.table.dialogs.revoke');
  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    danger
    cancelButton
    okButton={{ label: t('revokeButton'), onClick: async () => { await props.apiKey.revoke(); } }}
    confirmText={t('confirmText')}
  >
    {t('description', { 
      clientKey: props.apiKey.publishableClientKey?.lastFour,
      serverKey: props.apiKey.secretServerKey?.lastFour 
    })}
  </ActionDialog>;
}

function Actions({ row }: { row: Row<ExtendedInternalApiKey> }) {
  const t = useTranslations('apiKeys.table.actions');
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  return (
    <>
      <RevokeDialog apiKey={row.original} open={isRevokeModalOpen} onOpenChange={setIsRevokeModalOpen} />
      <ActionCell
        invisible={row.original.status !== 'valid'}
        items={[{
          item: t('revoke'),
          danger: true,
          onClick: () => setIsRevokeModalOpen(true),
        }]}
      />
    </>
  );
}

const getColumns = (t: any): ColumnDef<ExtendedInternalApiKey>[] =>  [
  {
    accessorKey: "description",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('description')} />,
    cell: ({ row }) => <TextCell size={300}>{row.original.description}</TextCell>,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('status')} />,
    cell: ({ row }) => <BadgeCell badges={[row.original.status]} />,
    filterFn: standardFilterFn,
  },
  {
    id: "clientKey",
    accessorFn: (row) => row.publishableClientKey?.lastFour,
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('clientKey')} />,
    cell: ({ row }) => <TextCell>*******{row.original.publishableClientKey?.lastFour}</TextCell>,
    enableSorting: false,
  },
  {
    id: "serverKey",
    accessorFn: (row) => row.secretServerKey?.lastFour,
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('serverKey')} />,
    cell: ({ row }) => <TextCell>*******{row.original.secretServerKey?.lastFour}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: "expiresAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('expiresAt')} />,
    cell: ({ row }) => <DateCell date={row.original.expiresAt} ignoreAfterYears={50} />
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('createdAt')} />,
    cell: ({ row }) => <DateCell date={row.original.createdAt} ignoreAfterYears={50} />
  },
  {
    id: "actions",
    cell: ({ row }) => <Actions row={row} />,
  },
];

export function InternalApiKeyTable(props: { apiKeys: InternalApiKey[] }) {
  const t = useTranslations('apiKeys.table.columns');
  const tStatus = useTranslations('apiKeys.table.status');
  const tSearch = useTranslations('apiKeys.table');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const columns = useMemo(() => getColumns(t), [t]);
  
  const statusOptions = useMemo(() => [
    { value: 'valid', label: tStatus('valid') },
    { value: 'expired', label: tStatus('expired') },
    { value: 'revoked', label: tStatus('revoked') }
  ], [tStatus]);
  
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

  return <DataTable
    data={extendedApiKeys}
    columns={columns}
    toolbarRender={(table) => toolbarRender(table, tSearch('searchPlaceholder'), tStatus('title'), statusOptions)}
    defaultColumnFilters={[{ id: 'status', value: ['valid'] }]}
    defaultSorting={[]}
    i18n={{
      resetFilters: tToolbar('resetFilters'),
      exportCSV: tToolbar('exportCSV'),
      noDataToExport: tToolbar('noDataToExport'),
      view: tToolbar('view'),
      toggleColumns: tToolbar('toggleColumns'),
      rowsSelected: (selected: number, total: number) => tPagination('rowsSelected', { selected, total }),
      rowsPerPage: tPagination('rowsPerPage'),
      previousPage: tPagination('goToPreviousPage'),
      nextPage: tPagination('goToNextPage'),
    } satisfies DataTableI18n}
  />;
}
