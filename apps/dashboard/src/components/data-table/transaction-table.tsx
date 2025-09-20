'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import type { AdminTransaction } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { DataTableColumnHeader, DataTableManualPagination, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TextCell } from '@stackframe/stack-ui';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
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

function formatDisplayType(t: AdminTransaction['type']): string {
  switch (t) {
    case 'subscription': {
      return 'Subscription';
    }
    case 'one_time': {
      return 'One Time';
    }
    case 'item_quantity_change': {
      return 'Item Quantity Change';
    }
    default: {
      return t;
    }
  }
}

const columns: ColumnDef<AdminTransaction>[] = [
  {
    accessorKey: 'type',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Type" />,
    cell: ({ row }) => <TextCell size={100}>{formatDisplayType(row.original.type)}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'customer_type',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer Type" />,
    cell: ({ row }) => <TextCell>{row.original.customer_type}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'customer_id',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer ID" />,
    cell: ({ row }) => (
      <TextCell>{row.original.customer_id}</TextCell>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'offer_or_item',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Offer / Item" />,
    cell: ({ row }) => (
      <TextCell>
        {row.original.type === 'item_quantity_change' ? (row.original.item_id ?? '—') : (row.original.offer_display_name || '—')}
      </TextCell>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'price',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Price" />,
    cell: ({ row }) => <TextCell size={80}>{formatPrice(row.original.price)}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'quantity',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Quantity" />,
    cell: ({ row }) => <TextCell>{row.original.quantity}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'test_mode',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Test Mode" />,
    cell: ({ row }) => <div>{row.original.test_mode ? '✓' : ''}</div>,
    enableSorting: false,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
    cell: ({ row }) => <TextCell>{row.original.status ?? '—'}</TextCell>,
    enableSorting: false,
  },
  {
    accessorKey: 'created_at_millis',
    header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Created" className="justify-end" />,
    cell: ({ row }) => (
      <div className="min-w-[120px] w-full text-right pr-2">{new Date(row.original.created_at_millis).toLocaleString()}</div>
    ),
    enableSorting: false,
  },
];

export function TransactionTable() {
  const app = useAdminApp();
  const [filters, setFilters] = React.useState<{ cursor?: string, limit?: number, type?: 'subscription' | 'one_time' | 'item_quantity_change', customerType?: 'user' | 'team' | 'custom' }>({
    limit: 10,
  });

  const { transactions, nextCursor } = app.useTransactions(filters);

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
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear">All types</SelectItem>
              <SelectItem value="subscription">Subscription</SelectItem>
              <SelectItem value="one_time">One-time</SelectItem>
              <SelectItem value="item_quantity_change">Item quantity change</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={(table.getColumn('customer_type')?.getFilterValue() as string | undefined) ?? ''}
            onValueChange={(v) => table.getColumn('customer_type')?.setFilterValue(v === '__clear' ? undefined : v)}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue placeholder="Customer type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear">All customers</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="team">Team</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    />
  );
}


