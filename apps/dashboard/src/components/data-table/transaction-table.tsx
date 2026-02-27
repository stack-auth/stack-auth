'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { ActionCell, ActionDialog, Alert, AlertDescription, AvatarCell, Badge, Button, DateCell, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, TextCell, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, CaretLeftIcon, CaretRightIcon, GearIcon, ProhibitIcon, QuestionIcon, ShoppingCartIcon, ShuffleIcon } from '@phosphor-icons/react';
import type { Transaction, TransactionEntry, TransactionType } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { TRANSACTION_TYPES } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import type { MoneyAmount } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { SUPPORTED_CURRENCIES } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { moneyAmountToStripeUnits } from '@stackframe/stack-shared/dist/utils/currencies';
import { moneyAmountSchema } from '@stackframe/stack-shared/dist/schema-fields';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import type { ColumnDef } from '@tanstack/react-table';
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from '../link';
import { useCursorPaginationCache } from "./common/cursor-pagination";
import { PaginationControls } from "./common/pagination";
import { TableContent, type ColumnLayout, type ColumnMeta } from "./common/table";
import { TableSkeleton } from "./common/table-skeleton";
import { createSimpleFingerprint, usePaginatedData } from "./common/use-paginated-data";

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
  if (transaction.entries.some(isItemQuantityChangeEntry)) {
    return 'item_quantity_change';
  }
  const productGrant = transaction.entries.find(isProductGrantEntry);
  if (productGrant?.subscription_id) {
    return 'subscription';
  }
  if (productGrant?.one_time_purchase_id) {
    return 'one_time';
  }
  if (productGrant) {
    return 'other';
  }
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
      return { label: '—', Icon: QuestionIcon };
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
  if (!entry) {
    return '—';
  }
  const chargedAmount = entry.charged_amount as Record<string, string | undefined>;
  if ("USD" in chargedAmount) {
    return `$${chargedAmount.USD}`;
  }
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
  if (!entry.price_id) {
    return null;
  }
  const product = entry.product as { prices?: Record<string, { USD?: string } | undefined> | "include-by-default" } | null | undefined;
  if (!product || !product.prices || product.prices === "include-by-default") {
    return null;
  }
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [refundSelections, setRefundSelections] = useState<RefundEntrySelection[]>([]);
  const [refundAmountUsd, setRefundAmountUsd] = useState<string>('');
  const target = transaction.type === 'purchase' ? refundTarget : null;
  const alreadyRefunded = transaction.adjusted_by.length > 0;
  const productEntries = useMemo(() => getRefundableProductEntries(transaction), [transaction]);
  const canRefund = !!target && !transaction.test_mode && !alreadyRefunded && productEntries.length > 0;
  const moneyTransferEntry = transaction.entries.find(isMoneyTransferEntry);
  const chargedAmountUsd = moneyTransferEntry ? (moneyTransferEntry.charged_amount.USD ?? null) : null;

  useEffect(() => {
    if (isDialogOpen) {
      setRefundSelections(productEntries.map(({ entryIndex, entry }) => ({
        entryIndex,
        quantity: entry.quantity,
      })));
      setRefundAmountUsd(chargedAmountUsd ?? '');
    }
  }, [chargedAmountUsd, isDialogOpen, productEntries]);

  const refundCandidates = useMemo(() => {
    return productEntries.map(({ entryIndex, entry }) => ({
      entryIndex,
      entry,
      productName: getProductDisplayName(entry),
      maxQuantity: entry.quantity,
      unitPriceUsd: getUsdUnitPrice(entry),
    }));
  }, [productEntries]);

  const selectionByIndex = useMemo(() => {
    return new Map(refundSelections.map((selection) => [selection.entryIndex, selection.quantity]));
  }, [refundSelections]);

  const canComputeRefundEntries = refundCandidates.length > 0 && refundCandidates.every((candidate) => candidate.unitPriceUsd);
  const selectedEntries = refundCandidates.map((candidate) => {
    const selectedQuantity = selectionByIndex.get(candidate.entryIndex) ?? candidate.maxQuantity;
    return { ...candidate, selectedQuantity };
  });
  const totalSelectedQuantity = selectedEntries.reduce((sum, entry) => sum + entry.selectedQuantity, 0);

  const refundValidation = useMemo(() => {
    if (!chargedAmountUsd || !USD_CURRENCY) {
      return { canSubmit: false, error: "Refund amounts are only supported for USD charges.", refundEntries: undefined };
    }
    if (!refundAmountUsd) {
      return { canSubmit: false, error: "Enter a refund amount.", refundEntries: undefined };
    }
    const isValid = moneyAmountSchema(USD_CURRENCY).defined().isValidSync(refundAmountUsd);
    if (!isValid) {
      return { canSubmit: false, error: "Refund amount must be a valid USD amount.", refundEntries: undefined };
    }
    const refundUnits = moneyAmountToStripeUnits(refundAmountUsd as MoneyAmount, USD_CURRENCY);
    const maxChargedUnits = moneyAmountToStripeUnits(chargedAmountUsd as MoneyAmount, USD_CURRENCY);
    if (refundUnits < 0) {
      return { canSubmit: false, error: "Refund amount cannot be negative.", refundEntries: undefined };
    }
    if (refundUnits > maxChargedUnits) {
      return { canSubmit: false, error: `Refund amount cannot exceed $${chargedAmountUsd}.`, refundEntries: undefined };
    }
    if (!canComputeRefundEntries) {
      return { canSubmit: false, error: "Refund entries are only supported for USD-priced products.", refundEntries: undefined };
    }
    if (totalSelectedQuantity < 0) {
      return { canSubmit: false, error: "Quantity cannot be negative.", refundEntries: undefined };
    }
    const maxUnits = maxChargedUnits;
    const selectedUnits = selectedEntries.reduce((sum, entry) => {
      if (!entry.unitPriceUsd) {
        return sum;
      }
      const entryUnits = moneyAmountToStripeUnits(entry.unitPriceUsd, USD_CURRENCY) * entry.selectedQuantity;
      return sum + entryUnits;
    }, 0);
    if (selectedUnits < 0) {
      return { canSubmit: false, error: "Quantity cannot be negative.", refundEntries: undefined };
    }
    if (selectedUnits > maxUnits) {
      return { canSubmit: false, error: `Refund amount cannot exceed $${chargedAmountUsd}.`, refundEntries: undefined };
    }
    const entries = selectedEntries
      .filter((entry) => entry.selectedQuantity > 0)
      .map((entry) => ({ entryIndex: entry.entryIndex, quantity: entry.selectedQuantity }));
    const fallbackEntry = selectedEntries[0] ?? throwErr("Refund entry missing for refund entries");
    const normalizedEntries = entries.length > 0
      ? entries
      : [{ entryIndex: fallbackEntry.entryIndex, quantity: 0 }];
    const refundEntries = normalizedEntries.map((entry, index) => ({
      ...entry,
      amountUsd: (index === 0 ? refundAmountUsd : "0") as MoneyAmount,
    }));
    return { canSubmit: true, error: null, refundEntries };
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
              });
            },
            props: chargedAmountUsd ? { disabled: !refundValidation.canSubmit } : undefined,
          }}
          confirmText="Refunds cannot be undone"
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
            if (!target) {
              return;
            }
            setIsDialogOpen(true);
          },
        }]}
      />
    </>
  );
}

type QueryState = {
  page: number,
  pageSize: number,
  cursor?: string,
  type?: TransactionType,
  customerType?: 'user' | 'team' | 'custom',
};

const DEFAULT_PAGE_SIZE = 10;

type ColumnKey = "type" | "customer" | "amount" | "detail" | "created" | "actions";

const COLUMN_LAYOUT: ColumnLayout<ColumnKey> = {
  type: { size: 60, minWidth: 50, maxWidth: 70, width: "60px", headerClassName: "text-center", cellClassName: "text-center" },
  customer: { size: 180, minWidth: 120, maxWidth: 200, width: "clamp(120px, 20vw, 200px)" },
  amount: { size: 100, minWidth: 80, maxWidth: 120, width: "clamp(80px, 15vw, 120px)" },
  detail: { size: 180, minWidth: 120, maxWidth: 220, width: "clamp(120px, 20vw, 220px)" },
  created: { size: 120, minWidth: 100, maxWidth: 140, width: "clamp(100px, 15vw, 140px)" },
  actions: { size: 60, minWidth: 50, maxWidth: 70, width: "60px", headerClassName: "text-right", cellClassName: "text-right" },
};

export function TransactionTable() {
  const [query, setQuery] = useState<QueryState>({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  const cursorPaginationCache = useCursorPaginationCache();

  useEffect(() => {
    cursorPaginationCache.resetCache();
  }, [cursorPaginationCache, query.type, query.customerType, query.pageSize]);

  return (
    <div className="space-y-2">
      <TransactionTableHeader
        type={query.type}
        onTypeChange={(type) => setQuery((prev) => ({ ...prev, type, page: 1, cursor: undefined }))}
        customerType={query.customerType}
        onCustomerTypeChange={(customerType) => setQuery((prev) => ({ ...prev, customerType, page: 1, cursor: undefined }))}
      />
      <div className="overflow-clip rounded-md border border-border bg-card">
        <Suspense fallback={<TransactionTableSkeleton pageSize={query.pageSize} />}>
          <TransactionTableBody
            query={query}
            setQuery={setQuery}
            cursorPaginationCache={cursorPaginationCache}
          />
        </Suspense>
      </div>
    </div>
  );
}

function TransactionTableHeader(props: {
  type?: TransactionType,
  onTypeChange: (type: TransactionType | undefined) => void,
  customerType?: 'user' | 'team' | 'custom',
  onCustomerTypeChange: (customerType: 'user' | 'team' | 'custom' | undefined) => void,
}) {
  const { type, onTypeChange, customerType, onCustomerTypeChange } = props;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={type ?? ''}
        onValueChange={(v) => onTypeChange(v === '__clear' ? undefined : v as TransactionType)}
      >
        <SelectTrigger className="h-8 w-[200px] overflow-x-clip">
          <div className="flex items-center gap-2">
            <SelectValue placeholder="Filter by type" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__clear">All types</SelectItem>
          {TRANSACTION_TYPES.map((transactionType) => {
            const { Icon: TypeIcon, label } = formatTransactionTypeLabel(transactionType);
            return (
              <SelectItem key={transactionType} value={transactionType}>
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
        value={customerType ?? ''}
        onValueChange={(v) => onCustomerTypeChange(v === '__clear' ? undefined : v as 'user' | 'team' | 'custom')}
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
}

function TransactionTableBody(props: {
  query: QueryState,
  setQuery: React.Dispatch<React.SetStateAction<QueryState>>,
  cursorPaginationCache: ReturnType<typeof useCursorPaginationCache>,
}) {
  const app = useAdminApp();
  const { query, setQuery } = props;

  const { transactions: rawTransactions, nextCursor: rawNextCursor } = app.useTransactions({
    limit: query.pageSize,
    cursor: query.cursor,
    type: query.type,
    customerType: query.customerType,
  });

  const { data: transactions, nextCursor, hasNextPage, hasPreviousPage, cursorForPage } = usePaginatedData(
    {
      data: rawTransactions,
      nextCursor: rawNextCursor,
      query,
      getFingerprint: createSimpleFingerprint,
    },
    props.cursorPaginationCache,
  );

  const summaryById = useMemo(() => {
    return new Map(transactions.map((transaction) => [transaction.id, getTransactionSummary(transaction)]));
  }, [transactions]);

  const columns = useMemo((): ColumnDef<Transaction>[] => [
    {
      id: 'type',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.sourceType ?? 'other',
      header: () => <span className="text-xs font-medium">Type</span>,
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
      meta: { columnKey: "type" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: 'customer',
      accessorFn: (transaction) => summaryById.get(transaction.id)?.customerType ?? '',
      header: () => <span className="text-xs font-medium">Customer</span>,
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
      meta: { columnKey: "customer" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: 'amount',
      header: () => <span className="text-xs font-medium">Amount</span>,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return <TextCell size={80}>{summary?.amountDisplay ?? '—'}</TextCell>;
      },
      meta: { columnKey: "amount" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: 'detail',
      header: () => <span className="text-xs font-medium">Details</span>,
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
      meta: { columnKey: "detail" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: 'created',
      accessorFn: (transaction) => transaction.created_at_millis,
      header: () => <span className="text-xs font-medium">Created</span>,
      cell: ({ row }) => (
        <DateCell date={new Date(row.original.created_at_millis)} />
      ),
      meta: { columnKey: "created" } satisfies ColumnMeta<ColumnKey>,
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const summary = summaryById.get(row.original.id);
        return (
          <RefundActionCell
            transaction={row.original}
            refundTarget={summary?.refundTarget ?? null}
          />
        );
      },
      meta: { columnKey: "actions" } satisfies ColumnMeta<ColumnKey>,
    },
  ], [summaryById]);

  const table = useReactTable({
    data: transactions,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-col">
      <TableContent
        table={table}
        columnLayout={COLUMN_LAYOUT}
        renderEmptyState={() => (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">No transactions found</p>
          </div>
        )}
        rowHeightPx={56}
      />
      <PaginationControls
        page={query.page}
        pageSize={query.pageSize}
        hasNextPage={hasNextPage}
        hasPreviousPage={hasPreviousPage}
        onPageSizeChange={(value) =>
          setQuery((prev) => ({ ...prev, pageSize: value, page: 1, cursor: undefined }))
        }
        onPreviousPage={() => {
          if (!hasPreviousPage) {
            return;
          }
          const previousPage = query.page - 1;
          const previousCursor = cursorForPage(previousPage);
          setQuery((prev) => ({
            ...prev,
            page: previousPage,
            cursor: previousPage === 1 ? undefined : previousCursor ?? undefined,
          }));
        }}
        onNextPage={() => {
          if (!hasNextPage || !nextCursor) {
            return;
          }
          setQuery((prev) => ({
            ...prev,
            page: query.page + 1,
            cursor: nextCursor,
          }));
        }}
        className="border-t border-border/70"
      />
    </div>
  );
}

function TransactionTableSkeleton(props: { pageSize: number }) {
  const columnOrder: ColumnKey[] = ["type", "customer", "amount", "detail", "created", "actions"];
  const skeletonHeaders: Record<ColumnKey, string | null> = {
    type: "Type",
    customer: "Customer",
    amount: "Amount",
    detail: "Details",
    created: "Created",
    actions: null,
  };

  const renderSkeletonCell = (columnKey: ColumnKey): JSX.Element => {
    switch (columnKey) {
      case "type": {
        return <Skeleton className="h-6 w-6 rounded-md mx-auto" />;
      }
      case "customer": {
        return (
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        );
      }
      case "amount": {
        return <Skeleton className="h-3 w-16" />;
      }
      case "detail": {
        return <Skeleton className="h-3 w-28" />;
      }
      case "created": {
        return <Skeleton className="h-3 w-20" />;
      }
      case "actions": {
        return <Skeleton className="h-4 w-4 ml-auto" />;
      }
      default: {
        return <Skeleton className="h-3 w-20" />;
      }
    }
  };

  return (
    <div className="flex flex-col">
      <TableSkeleton
        columnOrder={columnOrder}
        columnLayout={COLUMN_LAYOUT}
        headerLabels={skeletonHeaders}
        rowCount={props.pageSize}
        renderCellSkeleton={renderSkeletonCell}
        rowHeightPx={56}
      />
      <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Skeleton className="h-8 w-16" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled>
            <CaretLeftIcon className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="rounded-md border border-border px-3 py-1 text-xs font-medium">
            Page …
          </span>
          <Button variant="ghost" size="sm" disabled>
            Next
            <CaretRightIcon className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
