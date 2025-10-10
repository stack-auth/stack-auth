'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import type { AdminTransaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { DataTableColumnHeader, DataTableI18n, DataTableManualPagination, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TextCell } from '@stackframe/stack-ui';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import React from 'react';

function formatPrice(p: AdminTransaction['price']): string {
  if (!p) return '—';
  const currencyKey = ('USD' in p ? 'USD' : Object.keys(p).find(k => k !== 'interval')) as string | undefined;
  if (!currencyKey) return '—';
  const raw = p[currencyKey as keyof typeof p] as string | undefined;
  if (!raw) return '—';
  const amount = Number(raw).toFixed(2).replace(/\.00$/, '');
  if (Array.isArray(p.interval)) {
    const [n, unit] = p.interval as [number, string];
    return n === 1 ? `$${amount} / ${unit}` : `$${amount} / ${n} ${unit}`;
  }
  return `$${amount}`;
}

function formatDisplayType(t: AdminTransaction['type'], tTypes: any): string {
  switch (t) {
    case 'subscription': {
      return tTypes('subscription');
    }
    case 'one_time': {
      return tTypes('oneTime');
    }
    case 'item_quantity_change': {
      return tTypes('itemQuantityChange');
    }
    default: {
      return t;
    }
  }
}

const getColumns = (t: any, tTypes: any): ColumnDef<AdminTransaction>[] => [
  {
    accessorKey: 'type',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('type')} />,
    cell: ({ row }) => <TextCell size={100}>{formatDisplayType(row.original.type, tTypes)}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'customer_type',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('customerType')} />,
    cell: ({ row }) => <TextCell>{row.original.customer_type}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'customer_id',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('customerId')} />,
    cell: ({ row }) => (
      <TextCell>{row.original.customer_id}</TextCell>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'offer_or_item',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('offerOrItem')} />,
    cell: ({ row }) => (
      <TextCell>
        {row.original.type === 'item_quantity_change' ? (row.original.item_id ?? '—') : (row.original.offer_display_name || '—')}
      </TextCell>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'price',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('price')} />,
    cell: ({ row }) => <TextCell size={80}>{formatPrice(row.original.price)}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'quantity',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('quantity')} />,
    cell: ({ row }) => <TextCell>{row.original.quantity}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'test_mode',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('testMode')} />,
    cell: ({ row }) => <div>{row.original.test_mode ? '✓' : ''}</div>,
    enableSorting: false,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('status')} />,
    cell: ({ row }) => <TextCell>{row.original.status ?? '—'}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'created_at_millis',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle={t('created')} className="justify-end" />,
    cell: ({ row }) => (
      <div className="min-w-[120px] w-full text-right pr-2">{new Date(row.original.created_at_millis).toLocaleString()}</div>
    ),
    enableSorting: false,
  },
];

export function TransactionTable() {
  const t = useTranslations('transactions.table.columns');
  const tTypes = useTranslations('transactions.table.types');
  const tFilters = useTranslations('transactions.table.filters');
  const tToolbar = useTranslations('common.dataTable.toolbar');
  const tPagination = useTranslations('common.dataTable.pagination');
  
  const app = useAdminApp();
  const [filters, setFilters] = React.useState<{ cursor?: string, limit?: number, type?: 'subscription' | 'one_time' | 'item_quantity_change', customerType?: 'user' | 'team' | 'custom' }>({
    limit: 10,
  });

  const { transactions, nextCursor } = app.useTransactions(filters);
  
  const columns = React.useMemo(() => getColumns(t, tTypes), [t, tTypes]);

  const onUpdate = async (options: {
    cursor: string,
    limit: number,
    sorting: SortingState,
    columnFilters: ColumnFiltersState,
    globalFilters: any,
  }) => {
    const newFilters: { cursor?: string, limit?: number, type?: 'subscription' | 'one_time' | 'item_quantity_change', customerType?: 'user' | 'team' | 'custom' } = {
      cursor: options.cursor,
      limit: options.limit,
      type: options.columnFilters.find(f => f.id === 'type')?.value as any,
      customerType: options.columnFilters.find(f => f.id === 'customer_type')?.value as any,
    };
    if (deepPlainEquals(newFilters, filters, { ignoreUndefinedValues: true })) {
      return { nextCursor: nextCursor ?? null };
    }

    setFilters(newFilters);
    const res = await app.listTransactions(newFilters);
    return { nextCursor: res.nextCursor };
  };

  return (
    <DataTableManualPagination
      columns={columns}
      data={transactions}
      onUpdate={onUpdate}
      defaultVisibility={{
        // Show only the most important columns by default
        type: true,
        customer_type: true,
        customer_id: true,
        price: true,
        // Hide the rest by default; users can enable via View menu
        offer_or_item: false,
        quantity: false,
        test_mode: true,
        status: false,
        created_at_millis: true,
      }}
      defaultColumnFilters={[
        { id: 'type', value: filters.type ?? undefined },
        { id: 'customer_type', value: filters.customerType ?? undefined },
      ]}
      defaultSorting={[]}
      toolbarRender={(table) => (
        <div className="flex items-center gap-2">
          <Select
            value={(table.getColumn('type')?.getFilterValue() as string | undefined) ?? ''}
            onValueChange={(v) => table.getColumn('type')?.setFilterValue(v === '__clear' ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder={tFilters('filterByType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear">{tFilters('allTypes')}</SelectItem>
              <SelectItem value="subscription">{tTypes('subscription')}</SelectItem>
              <SelectItem value="one_time">{tTypes('oneTime')}</SelectItem>
              <SelectItem value="item_quantity_change">{tTypes('itemQuantityChange')}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={(table.getColumn('customer_type')?.getFilterValue() as string | undefined) ?? ''}
            onValueChange={(v) => table.getColumn('customer_type')?.setFilterValue(v === '__clear' ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder={tFilters('customerType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear">{tFilters('allCustomers')}</SelectItem>
              <SelectItem value="user">{tFilters('user')}</SelectItem>
              <SelectItem value="team">{tFilters('team')}</SelectItem>
              <SelectItem value="custom">{tFilters('custom')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
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
    />
  );
}


