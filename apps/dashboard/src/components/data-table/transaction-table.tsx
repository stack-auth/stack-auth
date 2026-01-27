'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { ActionCell, ActionDialog, Alert, AlertDescription, AvatarCell, Badge, DataTableColumnHeader, DataTableManualPagination, DateCell, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, TextCell, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, GearIcon, ProhibitIcon, QuestionIcon, ShoppingCartIcon, ShuffleIcon } from '@phosphor-icons/react';
import type { Transaction, TransactionEntry, TransactionType } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { TRANSACTION_TYPES } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import type { MoneyAmount } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { SUPPORTED_CURRENCIES } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { moneyAmountToStripeUnits } from '@stackframe/stack-shared/dist/utils/currencies';
import { moneyAmountSchema } from '@stackframe/stack-shared/dist/schema-fields';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import type { ColumnDef, ColumnFiltersState, SortingState } from '@tanstack/react-table';
import React, { useCallback } from 'react';
import { Link } from '../link';

type SourceType = 'subscription' | 'one_time' | 'item_quantity_change' | 'other';

type TransactionTypeDisplay = {
  label: string,
  Icon: PhosphorIcon,
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
type RefundEntrySelection = { entryIndex: number, quantity: number };
const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === 'USD');

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
      return { label: 'Purchase', Icon: ShoppingCartIcon };
    }
    case 'subscription-renewal': {
      return { label: 'Subscription Renewal', Icon: ArrowClockwiseIcon };
    }
    case 'subscription-cancellation': {
      return { label: 'Subscription Cancellation', Icon: ProhibitIcon };
    }
    case 'chargeback': {
      return { label: 'Chargeback', Icon: ArrowCounterClockwiseIcon };
    }
    case 'manual-item-quantity-change': {
      return { label: 'Manual Item Quantity Change', Icon: GearIcon };
    }
    case 'product-change': {
      return { label: 'Product Change', Icon: ShuffleIcon };
    }
    default: {
      return { label: (transactionType as any) ?? '—', Icon: QuestionIcon };
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

function getRefundableProductEntries(transaction: Transaction): Array<{ entryIndex: number, entry: ProductGrantEntry }> {
  return transaction.entries.flatMap((entry, entryIndex) => (
    isProductGrantEntry(entry) ? [{ entryIndex, entry }] : []
  ));
}

function getProductDisplayName(entry: ProductGrantEntry): string {
  const product = entry.product as { display_name?: string } | null | undefined;
  return product?.display_name ?? entry.product_id ?? 'Product';
}

function getUsdUnitPrice(entry: ProductGrantEntry): MoneyAmount | null {
  if (!entry.price_id) return null;
  const product = entry.product as { prices?: Record<string, { USD?: string } | undefined> | "include-by-default" } | null | undefined;
  if (!product || !product.prices || product.prices === "include-by-default") return null;
  const price = product.prices[entry.price_id];
  const usd = price?.USD;
  return typeof usd === 'string' ? (usd as MoneyAmount) : null;
}

function describeDetail(transaction: Transaction, sourceType: SourceType): string {
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant) {
    const name = getProductDisplayName(productGrant);
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
  const [refundSelections, setRefundSelections] = React.useState<RefundEntrySelection[]>([]);
  const [refundAmountUsd, setRefundAmountUsd] = React.useState<string>('');
  const target = transaction.type === 'purchase' ? refundTarget : null;
  const alreadyRefunded = transaction.adjusted_by.length > 0;
  const productEntries = React.useMemo(() => getRefundableProductEntries(transaction), [transaction]);
  const canRefund = !!target && !transaction.test_mode && !alreadyRefunded && productEntries.length > 0;
  const moneyTransferEntry = transaction.entries.find(isMoneyTransferEntry);
  const chargedAmountUsd = moneyTransferEntry ? (moneyTransferEntry.charged_amount.USD ?? null) : null;

  React.useEffect(() => {
    if (isDialogOpen) {
      setRefundSelections(productEntries.map(({ entryIndex, entry }) => ({
        entryIndex,
        quantity: entry.quantity,
      })));
      setRefundAmountUsd(chargedAmountUsd ?? '');
    }
  }, [chargedAmountUsd, isDialogOpen, productEntries]);

  const refundCandidates = React.useMemo(() => {
    return productEntries.map(({ entryIndex, entry }) => ({
      entryIndex,
      entry,
      productName: getProductDisplayName(entry),
      maxQuantity: entry.quantity,
      unitPriceUsd: getUsdUnitPrice(entry),
    }));
  }, [productEntries]);

  const selectionByIndex = React.useMemo(() => {
    return new Map(refundSelections.map((selection) => [selection.entryIndex, selection.quantity]));
  }, [refundSelections]);

  const canComputeRefundEntries = refundCandidates.length > 0 && refundCandidates.every((candidate) => candidate.unitPriceUsd);
  const selectedEntries = refundCandidates.map((candidate) => {
    const selectedQuantity = selectionByIndex.get(candidate.entryIndex) ?? candidate.maxQuantity;
    return { ...candidate, selectedQuantity };
  });
  const totalSelectedQuantity = selectedEntries.reduce((sum, entry) => sum + entry.selectedQuantity, 0);

  const refundValidation = React.useMemo(() => {
    if (!chargedAmountUsd || !USD_CURRENCY) {
      return { canSubmit: false, error: "Refund amounts are only supported for USD charges.", refundEntries: undefined, amountUsd: undefined };
    }
    if (!refundAmountUsd) {
      return { canSubmit: false, error: "Enter a refund amount.", refundEntries: undefined, amountUsd: undefined };
    }
    const isValid = moneyAmountSchema(USD_CURRENCY).defined().isValidSync(refundAmountUsd);
    if (!isValid) {
      return { canSubmit: false, error: "Refund amount must be a valid USD amount.", refundEntries: undefined, amountUsd: undefined };
    }
    const refundUnits = moneyAmountToStripeUnits(refundAmountUsd as MoneyAmount, USD_CURRENCY);
    const maxChargedUnits = moneyAmountToStripeUnits(chargedAmountUsd as MoneyAmount, USD_CURRENCY);
    if (refundUnits <= 0) {
      return { canSubmit: false, error: "Refund amount must be greater than zero.", refundEntries: undefined, amountUsd: undefined };
    }
    if (refundUnits > maxChargedUnits) {
      return { canSubmit: false, error: `Refund amount cannot exceed $${chargedAmountUsd}.`, refundEntries: undefined, amountUsd: undefined };
    }
    if (!canComputeRefundEntries) {
      return { canSubmit: false, error: "Refund entries are only supported for USD-priced products.", refundEntries: undefined, amountUsd: undefined };
    }
    if (totalSelectedQuantity <= 0) {
      return { canSubmit: false, error: "Select at least one product to refund.", refundEntries: undefined, amountUsd: undefined };
    }
    const maxUnits = maxChargedUnits;
    const selectedUnits = selectedEntries.reduce((sum, entry) => {
      if (!entry.unitPriceUsd) return sum;
      const entryUnits = moneyAmountToStripeUnits(entry.unitPriceUsd, USD_CURRENCY) * entry.selectedQuantity;
      return sum + entryUnits;
    }, 0);
    if (selectedUnits <= 0) {
      return { canSubmit: false, error: "Refund amount must be greater than zero.", refundEntries: undefined, amountUsd: undefined };
    }
    if (selectedUnits > maxUnits) {
      return { canSubmit: false, error: `Refund amount cannot exceed $${chargedAmountUsd}.`, refundEntries: undefined, amountUsd: undefined };
    }
    const refundEntries = selectedEntries
      .filter((entry) => entry.selectedQuantity > 0)
      .map((entry) => ({ entryIndex: entry.entryIndex, quantity: entry.selectedQuantity }));
    return { canSubmit: true, error: null, refundEntries, amountUsd: refundAmountUsd as MoneyAmount };
  }, [chargedAmountUsd, canComputeRefundEntries, refundAmountUsd, selectedEntries, totalSelectedQuantity]);

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
              if (chargedAmountUsd && !refundValidation.canSubmit) {
                return "prevent-close";
              }
              await app.refundTransaction({
                ...target,
                refundEntries: refundValidation.refundEntries ?? throwErr("Refund entries missing for refund"),
                amountUsd: refundValidation.amountUsd ?? throwErr("Refund amount missing for refund"),
              });
            },
            props: chargedAmountUsd ? { disabled: !refundValidation.canSubmit } : undefined,
          }}
          confirmText="Refunds cannot be undone and will revoke access to the purchased product."
        >
          <div className="space-y-4">
            <p>{`Refund this ${target.type === 'subscription' ? 'subscription' : 'one-time purchase'} transaction?`}</p>
            {chargedAmountUsd ? (
              <div className="space-y-2">
                <div className="space-y-2">
                  <Label htmlFor={`refund-amount-${transaction.id}`}>Refund amount (USD)</Label>
                  <Input
                    id={`refund-amount-${transaction.id}`}
                    inputMode="decimal"
                    placeholder={chargedAmountUsd}
                    value={refundAmountUsd}
                    onChange={(event) => setRefundAmountUsd(event.target.value)}
                  />
                </div>
                {canComputeRefundEntries ? (
                  <div className="space-y-3">
                    <Label>Products to refund</Label>
                    {selectedEntries.map((entry) => (
                      <div key={entry.entryIndex} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{entry.productName}</div>
                          <div className="text-xs text-muted-foreground">Purchased: {entry.maxQuantity}</div>
                        </div>
                        <Input
                          inputMode="numeric"
                          type="number"
                          min={0}
                          max={entry.maxQuantity}
                          value={entry.selectedQuantity}
                          onChange={(event) => {
                            const raw = Number.parseInt(event.target.value, 10);
                            const clamped = Number.isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), entry.maxQuantity);
                            setRefundSelections((prev) => prev.map((selection) => (
                              selection.entryIndex === entry.entryIndex ? { ...selection, quantity: clamped } : selection
                            )));
                          }}
                          className="w-24"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Alert>
                    <AlertDescription>
                      Partial refunds are only available for USD-priced products. This will issue a full refund.
                    </AlertDescription>
                  </Alert>
                )}
                {refundValidation.error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{refundValidation.error}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  Partial refunds are only available for USD charges. This will issue a full refund.
                </AlertDescription>
              </Alert>
            )}
          </div>
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

  const onUpdate = useCallback(async (options: {
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
  }, [app, filters, nextCursor]);


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
