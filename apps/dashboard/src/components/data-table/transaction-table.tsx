'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import type { Transaction, TransactionEntry } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { DataTableColumnHeader, DataTableManualPagination, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TextCell } from '@stackframe/stack-ui';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import React from 'react';

type SourceType = 'subscription' | 'one_time' | 'item_quantity_change' | 'other';

type TransactionSummary = {
  sourceType: SourceType,
  displayType: string,
  customerType: string | null,
  customerId: string | null,
  detail: string,
  amountDisplay: string,
};

type EntryWithCustomer = Extract<TransactionEntry, { customer_type: string, customer_id: string }>;
type MoneyTransferEntry = Extract<TransactionEntry, { type: 'money_transfer' }>;
type ProductGrantEntry = Extract<TransactionEntry, { type: 'product_grant' }>;
type ItemQuantityChangeEntry = Extract<TransactionEntry, { type: 'item_quantity_change' }>;

function isEntryWithCustomer(entry: TransactionEntry): entry is EntryWithCustomer {
  return 'customer_type' in entry && 'customer_id' in entry;
}

function isMoneyTransferEntry(entry: TransactionEntry): entry is MoneyTransferEntry {
  return entry.type === 'money_transfer';
}

function isProductGrantEntry(entry: TransactionEntry): entry is ProductGrantEntry {
  return entry.type === 'product_grant';
}

function isItemQuantityChangeEntry(entry: TransactionEntry): entry is ItemQuantityChangeEntry {
  return entry.type === 'item_quantity_change';
}

function deriveSourceType(transaction: Transaction): SourceType {
  if (transaction.entries.some(isItemQuantityChangeEntry)) return 'item_quantity_change';
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant?.subscription_id) return 'subscription';
  if (productGrant?.one_time_purchase_id) return 'one_time';
  if (productGrant) return 'other';
  return 'other';
}

function formatTransactionTypeLabel(transaction: Transaction, sourceType: SourceType): string {
  switch (transaction.type) {
    case 'purchase': {
      if (sourceType === 'subscription') return 'Subscription Purchase';
      if (sourceType === 'one_time') return 'One-time Purchase';
      return 'Purchase';
    }
    case 'subscription-renewal': {
      return 'Subscription Renewal';
    }
    case 'subscription-cancellation': {
      return 'Subscription Cancellation';
    }
    case 'chargeback': {
      return 'Chargeback';
    }
    case 'manual-item-quantity-change': {
      return 'Manual Item Quantity Change';
    }
    case 'upgrade': {
      return 'Upgrade';
    }
    case 'downgrade': {
      return 'Downgrade';
    }
    case 'product-change': {
      return 'Product Change';
    }
    default: {
      if (sourceType === 'item_quantity_change') return 'Item Quantity Change';
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- backend can send null transaction types and we need a human fallback
      return transaction.type ?? '—';
    }
  }
}

function pickChargedAmountDisplay(entry: MoneyTransferEntry | undefined): string {
  if (!entry) return '—';
  const chargedAmount = entry.charged_amount as Record<string, string | undefined>;
  const currency = 'USD' in chargedAmount ? 'USD' : Object.keys(chargedAmount)[0];
  if (!currency) return '—';
  const raw = chargedAmount[currency];
  if (raw == null) {
    return '—';
  }
  const numericValue = Number(raw);
  if (!Number.isFinite(numericValue)) {
    return `${currency} ${raw}`;
  }
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(numericValue);
  } catch {
    return `${currency} ${raw}`;
  }
}

function describeDetail(transaction: Transaction, sourceType: SourceType): string {
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant) {
    const product = productGrant.product as { displayName?: string } | null | undefined;
    const name = product?.displayName ?? productGrant.product_id ?? 'Product';
    const quantity = productGrant.quantity;
    return `${name} (×${quantity})`;
  }
  const itemChange = transaction.entries.find(isItemQuantityChangeEntry);
  if (itemChange) {
    const delta = itemChange.quantity;
    const deltaLabel = delta > 0 ? `+${delta}` : `${delta}`;
    return `${itemChange.item_id} (${deltaLabel})`;
  }
  if (sourceType === 'item_quantity_change') {
    return 'Item quantity change';
  }
  return '—';
}

function getTransactionSummary(transaction: Transaction): TransactionSummary {
  const sourceType = deriveSourceType(transaction);
  const customerEntry = transaction.entries.find(isEntryWithCustomer);
  const moneyTransferEntry = transaction.entries.find(isMoneyTransferEntry);

  return {
    sourceType,
    displayType: formatTransactionTypeLabel(transaction, sourceType),
    customerType: customerEntry?.customer_type ?? null,
    customerId: customerEntry?.customer_id ?? null,
    detail: describeDetail(transaction, sourceType),
    amountDisplay: pickChargedAmountDisplay(moneyTransferEntry),
  };
}

export function TransactionTable() {
  const app = useAdminApp();
  const [filters, setFilters] = React.useState<{ cursor?: string, limit?: number, type?: 'subscription' | 'one_time' | 'item_quantity_change', customerType?: 'user' | 'team' | 'custom' }>({
    limit: 10,
  });

  const { transactions, nextCursor } = app.useTransactions(filters);

  const summaryById = React.useMemo(() => {
    return new Map(transactions.map((transaction) => [transaction.id, getTransactionSummary(transaction)]));
  }, [transactions]);

  const columns = React.useMemo<ColumnDef<Transaction>[]>(() => [
    {
      id: 'source_type',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.sourceType ?? 'other',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Type" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell size={160}>{summary?.displayType ?? '—'}</TextCell>;
      },
      enableSorting: false,
    },
    {
      id: 'customer_type',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.customerType ?? '',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer Type" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell>{summary?.customerType ?? '—'}</TextCell>;
      },
      enableSorting: false,
    },
    {
      id: 'customer_id',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.customerId ?? '',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer ID" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell>{summary?.customerId ?? '—'}</TextCell>;
      },
      enableSorting: false,
    },
    {
      id: 'detail',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Details" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell>{summary?.detail ?? '—'}</TextCell>;
      },
      enableSorting: false,
    },
    {
      id: 'amount',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Amount" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell size={80}>{summary?.amountDisplay ?? '—'}</TextCell>;
      },
      enableSorting: false,
    },
    {
      id: 'test_mode',
      accessorFn: (transaction) => transaction.test_mode ? 'test' : '',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Test Mode" />,
      cell: ({ row }) => <div>{row.original.test_mode ? '✓' : ''}</div>,
      enableSorting: false,
    },
    {
      id: 'created_at_millis',
      accessorFn: (transaction) => transaction.created_at_millis,
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Created" className="justify-end" />,
      cell: ({ row }) => (
        <div className="min-w-[120px] w-full text-right pr-2">{new Date(row.original.created_at_millis).toLocaleString()}</div>
      ),
      enableSorting: false,
    },
  ], [summaryById]);

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
      type: options.columnFilters.find(f => f.id === 'source_type')?.value as any,
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
        source_type: true,
        customer_type: true,
        customer_id: true,
        amount: true,
        detail: false,
        test_mode: true,
        created_at_millis: true,
      }}
      defaultColumnFilters={[
        { id: 'source_type', value: filters.type ?? undefined },
        { id: 'customer_type', value: filters.customerType ?? undefined },
      ]}
      defaultSorting={[]}
      toolbarRender={(table) => (
        <div className="flex items-center gap-2">
          <Select
            value={(table.getColumn('source_type')?.getFilterValue() as string | undefined) ?? ''}
            onValueChange={(v) => table.getColumn('source_type')?.setFilterValue(v === '__clear' ? undefined : v)}
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
