'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import type { Transaction, TransactionEntry, TransactionType } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { TRANSACTION_TYPES } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { ActionCell, ActionDialog, AvatarCell, Badge, DataTableColumnHeader, DataTableManualPagination, DateCell, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TextCell, Tooltip, TooltipContent, TooltipTrigger } from '@stackframe/stack-ui';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import type { LucideIcon } from 'lucide-react';
import { Ban, CircleHelp, RefreshCcw, RotateCcw, Settings, ShoppingCart, Shuffle } from 'lucide-react';
import { Link } from '../link';
import React from 'react';

type SourceType = 'subscription' | 'one_time' | 'item_quantity_change' | 'other';

type TransactionTypeDisplay = {
  label: string,
  Icon: LucideIcon,
};

type TransactionSummary = {
  sourceType: SourceType,
  displayType: TransactionTypeDisplay,
  customerType: string | null,
  customerId: string | null,
  detail: string,
  amountDisplay: string,
  refundTarget: RefundTarget | null,
  refunded: boolean,
};

type EntryWithCustomer = Extract<TransactionEntry, { customer_type: string, customer_id: string }>;
type MoneyTransferEntry = Extract<TransactionEntry, { type: 'money_transfer' }>;
type ProductGrantEntry = Extract<TransactionEntry, { type: 'product_grant' }>;
type ItemQuantityChangeEntry = Extract<TransactionEntry, { type: 'item_quantity_change' }>;
type RefundTarget = { type: 'subscription' | 'one-time-purchase', id: string };

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

function getRefundTarget(transaction: Transaction): RefundTarget | null {
  if (transaction.type !== 'purchase') {
    return null;
  }
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant?.subscription_id) {
    return { type: 'subscription', id: productGrant.subscription_id };
  }
  if (productGrant?.one_time_purchase_id) {
    return { type: 'one-time-purchase', id: productGrant.one_time_purchase_id };
  }
  return null;
}

function deriveSourceType(transaction: Transaction): SourceType {
  if (transaction.entries.some(isItemQuantityChangeEntry)) return 'item_quantity_change';
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant?.subscription_id) return 'subscription';
  if (productGrant?.one_time_purchase_id) return 'one_time';
  if (productGrant) return 'other';
  return 'other';
}

function formatTransactionTypeLabel(transactionType: TransactionType | null): TransactionTypeDisplay {
  switch (transactionType) {
    case 'purchase': {
      return { label: 'Purchase', Icon: ShoppingCart };
    }
    case 'subscription-renewal': {
      return { label: 'Subscription Renewal', Icon: RefreshCcw };
    }
    case 'subscription-cancellation': {
      return { label: 'Subscription Cancellation', Icon: Ban };
    }
    case 'chargeback': {
      return { label: 'Chargeback', Icon: RotateCcw };
    }
    case 'manual-item-quantity-change': {
      return { label: 'Manual Item Quantity Change', Icon: Settings };
    }
    case 'product-change': {
      return { label: 'Product Change', Icon: Shuffle };
    }
    default: {
      return { label: (transactionType as any) ?? '—', Icon: CircleHelp };
    }
  }
}

function UserAvatarCell({ userId }: { userId: string }) {
  const app = useAdminApp();
  const user = app.useUser(userId);

  if (!user) {
    return <AvatarCell fallback='?' />;
  }
  return (
    <Link href={`/projects/${encodeURIComponent(app.projectId)}/users/${encodeURIComponent(userId)}`}>
      <div className="flex items-center gap-2 max-w-40 truncate">
        <AvatarCell
          src={user.profileImageUrl ?? undefined}
          fallback={user.displayName?.charAt(0) ?? user.primaryEmail?.charAt(0) ?? '?'}
        />
        {user.displayName ?? user.primaryEmail}
      </div>
    </Link>
  );
}

function TeamAvatarCell({ teamId }: { teamId: string }) {
  const app = useAdminApp();
  const team = app.useTeam(teamId);
  if (!team) {
    return <AvatarCell fallback='?' />;
  }
  return (
    <Link href={`/projects/${encodeURIComponent(app.projectId)}/teams/${encodeURIComponent(teamId)}`}>
      <div className="flex items-center gap-2 max-w-40 truncate">
        <AvatarCell
          src={team.profileImageUrl ?? undefined}
          fallback={team.displayName.charAt(0)}
        />
        {team.displayName}
      </div>
    </Link>
  );
}

function pickChargedAmountDisplay(entry: MoneyTransferEntry | undefined): string {
  if (!entry) return '—';
  const chargedAmount = entry.charged_amount as Record<string, string | undefined>;
  if ("USD" in chargedAmount) {
    return `$${chargedAmount.USD}`;
  }
  // TODO: Handle other currencies
  return 'Non USD amount';
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
  return '-';
}

function getTransactionSummary(transaction: Transaction): TransactionSummary {
  const sourceType = deriveSourceType(transaction);
  const customerEntry = transaction.entries.find(isEntryWithCustomer);
  const moneyTransferEntry = transaction.entries.find(isMoneyTransferEntry);
  const refundTarget = getRefundTarget(transaction);
  const refunded = transaction.adjusted_by.length > 0;

  return {
    sourceType,
    displayType: formatTransactionTypeLabel(transaction.type),
    customerType: customerEntry?.customer_type ?? null,
    customerId: customerEntry?.customer_id ?? null,
    detail: describeDetail(transaction, sourceType),
    amountDisplay: transaction.test_mode ? 'Test mode' : pickChargedAmountDisplay(moneyTransferEntry),
    refundTarget,
    refunded,
  };
}

function RefundActionCell({ transaction, refundTarget }: { transaction: Transaction, refundTarget: RefundTarget | null }) {
  const app = useAdminApp();
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const target = transaction.type === 'purchase' ? refundTarget : null;
  const alreadyRefunded = transaction.adjusted_by.length > 0;
  const productEntry = transaction.entries.find(isProductGrantEntry);
  const canRefund = !!target && !transaction.test_mode && !alreadyRefunded && productEntry?.price_id;

  return (
    <>
      {target ? (
        <ActionDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          title="Refund Transaction"
          danger
          cancelButton
          okButton={{
            label: "Refund",
            onClick: async () => {
              await app.refundTransaction(target);
              setIsDialogOpen(false);
            },
          }}
          confirmText="Refunds cannot be undone and will revoke access to the purchased product."
        >
          {`Refund this ${target.type === 'subscription' ? 'subscription' : 'one-time purchase'} transaction?`}
        </ActionDialog>
      ) : null}
      <ActionCell
        items={[{
          item: "Refund",
          danger: true,
          disabled: !canRefund,
          disabledTooltip: "This transaction cannot be refunded",
          onClick: () => {
            if (!target) return;
            setIsDialogOpen(true);
          },
        }]}
      />
    </>
  );
}

type Filters = {
  cursor?: string,
  limit?: number,
  type?: TransactionType,
  customerType?: 'user' | 'team' | 'custom',
};

export function TransactionTable() {
  const app = useAdminApp();
  const [filters, setFilters] = React.useState<Filters>({ limit: 10 });
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
        const displayType = summary?.displayType;
        if (!displayType) {
          return <TextCell size={20}>—</TextCell>;
        }
        const { Icon, label } = displayType;
        return (
          <TextCell size={20}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
          </TextCell>
        );
      },
      enableSorting: false,
    },
    {
      id: 'customer',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.customerType ?? '',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Customer" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        if (summary?.customerType === 'user' && summary.customerId) {
          return <UserAvatarCell userId={summary.customerId} />;
        }
        if (summary?.customerType === 'team' && summary.customerId) {
          return <TeamAvatarCell teamId={summary.customerId} />;
        }
        return (
          <TextCell>
            <>
              <span className="capitalize">{summary?.customerType ?? '—'}</span>
              : {summary?.customerId ?? '—'}
            </>
          </TextCell>
        );
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
      id: 'detail',
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Details" />,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return (
          <TextCell size={120}>
            <div className="flex items-center gap-2">
              <span className="truncate">{summary?.detail ?? '—'}</span>
              {summary?.refunded ? (
                <Badge variant="outline" className="text-xs">
                  Refunded
                </Badge>
              ) : null}
            </div>
          </TextCell>
        );
      },
      enableSorting: false,
    },
    {
      id: 'created_at_millis',
      accessorFn: (transaction) => transaction.created_at_millis,
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Created" />,
      cell: ({ row }) => (
        <DateCell date={new Date(row.original.created_at_millis)} />
      ),
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return (
          <RefundActionCell
            transaction={row.original}
            refundTarget={summary?.refundTarget ?? null}
          />
        );
      },
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
    const newFilters: { cursor?: string, limit?: number, type?: TransactionType, customerType?: 'user' | 'team' | 'custom' } = {
      cursor: options.cursor,
      limit: options.limit,
      type: options.columnFilters.find(f => f.id === 'source_type')?.value as any,
      customerType: options.columnFilters.find(f => f.id === 'customer')?.value as any,
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
        customer: true,
        amount: true,
        detail: true,
        created_at_millis: true,
        actions: true,
      }}
      defaultColumnFilters={[
        { id: 'source_type', value: undefined },
        { id: 'customer', value: undefined },
      ]}
      defaultSorting={[]}
      toolbarRender={(table) => {
        const selectedType = table.getColumn('source_type')?.getFilterValue() as TransactionType | undefined;

        return (
          <div className="flex items-center gap-2 ">
            <Select
              value={selectedType ?? ''}
              onValueChange={(v) => table.getColumn('source_type')?.setFilterValue(v === '__clear' ? undefined : v)}
            >
              <SelectTrigger className="h-8 w-[200px] overflow-x-clip">
                <div className="flex items-center gap-2">
                  <SelectValue placeholder="Filter by type" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__clear">All types</SelectItem>
                {TRANSACTION_TYPES.map((type) => {
                  const { Icon: TypeIcon, label } = formatTransactionTypeLabel(type);
                  return (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        <TypeIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <span className="truncate">{label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select
              value={(table.getColumn('customer')?.getFilterValue() as string | undefined) ?? ''}
              onValueChange={(v) => table.getColumn('customer')?.setFilterValue(v === '__clear' ? undefined : v)}
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
        );
      }}
    />
  );
}
