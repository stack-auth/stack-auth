// TODO(ui-fixes-minor): URL-synced cursor (page state) was dropped when this
// table moved from the hand-rolled cursor cache to DataGrid infinite scroll.
// Reload resets scroll position and re-fetches from scratch. Restore if
// product cares about deep-linking to specific rows.
'use client';

import { useAdminApp } from '@/app/(main)/(protected)/projects/[projectId]/use-admin-app';
import { ActionCell, ActionDialog, Alert, AlertDescription, AvatarCell, Badge, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, GearIcon, ProhibitIcon, QuestionIcon, ReceiptXIcon, ShoppingCartIcon, ShuffleIcon } from '@phosphor-icons/react';
import { createDefaultDataGridState, DataGrid, DataGridToolbar, useDataSource, type DataGridColumnDef, type DataGridDataSource, type DataGridState } from '@stackframe/dashboard-ui-components';
import type { Transaction, TransactionEntry, TransactionType } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { TRANSACTION_TYPES } from '@stackframe/stack-shared/dist/interface/crud/transactions';
import { moneyAmountSchema } from '@stackframe/stack-shared/dist/schema-fields';
import { moneyAmountToStripeUnits } from '@stackframe/stack-shared/dist/utils/currencies';
import type { MoneyAmount } from '@stackframe/stack-shared/dist/utils/currency-constants';
import { SUPPORTED_CURRENCIES } from '@stackframe/stack-shared/dist/utils/currency-constants';
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
    case 'refund': {
      return { label: 'Refund', Icon: ReceiptXIcon };
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

function getProductDisplayName(entry: ProductGrantEntry): string {
  const product = entry.product as { display_name?: string } | null | undefined;
  return product?.display_name ?? entry.product_id ?? 'Product';
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
  const [amountUsd, setAmountUsd] = useState<string>('0');
  const [revokeProduct, setRevokeProduct] = useState<boolean>(true);
  const [endSubscription, setEndSubscription] = useState<boolean>(true);
  const target = transaction.type === 'purchase' ? refundTarget : null;
  // Don't gate on `adjusted_by.length` here: the backend supports multiple
  // partial refunds (and a separate revoke) until both caps are hit, and
  // computes the actual remaining state from the bulldozer ledger. The button
  // stays available; the backend rejects if there's nothing left to do.
  //
  // Known UI gap: refund actions are only enabled on `purchase` rows, and the
  // submit call never passes `invoice_id`. The backend supports refunding a
  // specific renewal invoice (POST body `invoice_id`), but the dashboard
  // currently can't reach that path — admins refunding a renewal must use
  // the API directly. Follow-up: enable the action on `subscription-renewal`
  // rows and thread `invoice_id` through.
  const canRefund = !!target;
  const moneyTransferEntry = transaction.entries.find(isMoneyTransferEntry);
  const chargedAmountUsd = moneyTransferEntry ? (moneyTransferEntry.charged_amount.USD ?? null) : null;
  const isSubscription = target?.type === 'subscription';

  const validation = useMemo(() => {
    if (!target || !USD_CURRENCY) {
      return { canSubmit: false, error: null as string | null };
    }
    if (!moneyAmountSchema(USD_CURRENCY).defined().isValidSync(amountUsd)) {
      return { canSubmit: false, error: "Refund amount must be a valid USD amount." };
    }
    const refundUnits = moneyAmountToStripeUnits(amountUsd as MoneyAmount, USD_CURRENCY);
    if (refundUnits < 0) {
      return { canSubmit: false, error: "Refund amount cannot be negative." };
    }
    if (refundUnits > 0 && !chargedAmountUsd) {
      return { canSubmit: false, error: "This transaction has no money to refund (test mode or non-USD)." };
    }
    if (chargedAmountUsd) {
      const maxUnits = moneyAmountToStripeUnits(chargedAmountUsd as MoneyAmount, USD_CURRENCY);
      if (refundUnits > maxUnits) {
        return { canSubmit: false, error: `Refund amount cannot exceed $${chargedAmountUsd}.` };
      }
    }
    if (refundUnits === 0 && !revokeProduct && !endSubscription) {
      return { canSubmit: false, error: "Refund must do something: enter an amount, revoke product, or end subscription." };
    }
    return { canSubmit: true, error: null };
  }, [target, amountUsd, chargedAmountUsd, revokeProduct, endSubscription]);

  return (
    <>
      {target ? (
        <ActionDialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            if (open) {
              setAmountUsd(chargedAmountUsd ?? '0');
              setRevokeProduct(true);
              setEndSubscription(isSubscription);
            }
            setIsDialogOpen(open);
          }}
          title="Refund Transaction"
          danger
          cancelButton
          okButton={{
            label: "Refund",
            onClick: async () => {
              if (!validation.canSubmit) {
                return "prevent-close";
              }
              await app.refundTransaction({
                ...target,
                amountUsd: amountUsd as MoneyAmount,
                revokeProduct,
                ...(isSubscription ? { endSubscription } : {}),
              });
            },
            props: { disabled: !validation.canSubmit },
          }}
          confirmText="Refunds cannot be undone"
        >
          <div className="space-y-4">
            <p>{`Refund this ${isSubscription ? 'subscription' : 'one-time purchase'}?`}</p>
            <div className="space-y-2">
              <Label htmlFor={`refund-amount-${transaction.id}`}>Refund amount (USD)</Label>
              <Input
                id={`refund-amount-${transaction.id}`}
                inputMode="decimal"
                placeholder={chargedAmountUsd ?? '0'}
                value={amountUsd}
                onChange={(event) => setAmountUsd(event.target.value)}
                disabled={!chargedAmountUsd}
              />
              {!chargedAmountUsd ? (
                <p className="text-xs text-muted-foreground">No money to refund (test mode or non-USD).</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`revoke-product-${transaction.id}`}
                checked={revokeProduct}
                onCheckedChange={(value) => {
                  const next = value === true;
                  setRevokeProduct(next);
                  if (next && isSubscription) setEndSubscription(true);
                }}
              />
              <Label htmlFor={`revoke-product-${transaction.id}`} className="cursor-pointer">
                Revoke product
              </Label>
            </div>
            {isSubscription ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`end-subscription-${transaction.id}`}
                  checked={endSubscription}
                  onCheckedChange={(value) => setEndSubscription(value === true)}
                  disabled={revokeProduct}
                />
                <Label htmlFor={`end-subscription-${transaction.id}`} className="cursor-pointer">
                  End subscription{revokeProduct ? ' (forced when revoking)' : ''}
                </Label>
              </div>
            ) : null}
            {validation.error ? (
              <Alert variant="destructive">
                <AlertDescription>{validation.error}</AlertDescription>
              </Alert>
            ) : null}
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

type FilterState = {
  type?: TransactionType,
  customerType?: 'user' | 'team' | 'custom',
};

const PAGE_SIZE = 25;
const CUSTOMER_TYPE_OPTIONS = ["user", "team", "custom"] as const satisfies ReadonlyArray<NonNullable<FilterState["customerType"]>>;

export function TransactionTable() {
  const [filters, setFilters] = useState<FilterState>({});

  return (
    <TransactionTableBody filters={filters} setFilters={setFilters} />
  );
}

function TransactionTableBody(props: {
  filters: FilterState,
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>,
}) {
  const app = useAdminApp();
  const { filters, setFilters } = props;

  const dataSource = useMemo<DataGridDataSource<Transaction>>(
    () => async function* (params) {
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = await app.listTransactions({
        limit: PAGE_SIZE,
        type: filters.type,
        customerType: filters.customerType,
        cursor,
      });
      yield {
        rows: result.transactions,
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [app, filters.type, filters.customerType],
  );

  const getRowId = useCallback((row: Transaction) => row.id, []);

  // `summaryById` is populated AFTER useDataSource returns rows, but the
  // column `renderCell` closures read it via ref so columns can be defined
  // first and stay stable across paginate/append. Empty initially; filled
  // below once we have rows.
  const summaryByIdRef = useRef<Map<string, ReturnType<typeof getTransactionSummary>>>(new Map());

  const columns = useMemo<DataGridColumnDef<Transaction>[]>(() => [
    {
      id: 'type',
      header: 'Type',
      width: 60,
      minWidth: 50,
      maxWidth: 70,
      align: 'center',
      sortable: false,
      resizable: false,
      hideable: false,
      renderCell: ({ row }) => {
        const summary = summaryByIdRef.current.get(row.id);
        const displayType = summary?.displayType;
        if (!displayType) {
          return <span>—</span>;
        }
        const { Icon, label } = displayType;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">{label}</TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: 'customer',
      header: 'Customer',
      width: 180,
      minWidth: 120,
      maxWidth: 200,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => {
        const summary = summaryByIdRef.current.get(row.id);
        if (summary?.customerType === 'user' && summary.customerId) {
          return <UserAvatarCell userId={summary.customerId} />;
        }
        if (summary?.customerType === 'team' && summary.customerId) {
          return <TeamAvatarCell teamId={summary.customerId} />;
        }
        return (
          <span>
            <span className="capitalize">{summary?.customerType ?? '—'}</span>
            : {summary?.customerId ?? '—'}
          </span>
        );
      },
    },
    {
      id: 'amount',
      header: 'Amount',
      width: 100,
      minWidth: 80,
      maxWidth: 120,
      sortable: false,
      renderCell: ({ row }) => {
        const summary = summaryByIdRef.current.get(row.id);
        return <span>{summary?.amountDisplay ?? '—'}</span>;
      },
    },
    {
      id: 'detail',
      header: 'Details',
      width: 180,
      minWidth: 120,
      maxWidth: 220,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => {
        const summary = summaryByIdRef.current.get(row.id);
        return (
          <div className="flex items-center gap-2">
            <span className="truncate">{summary?.detail ?? '—'}</span>
            {summary?.refunded ? (
              <Badge variant="outline" className="text-xs">
                Refunded
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'created',
      header: 'Created',
      accessor: (row: Transaction) => new Date(row.created_at_millis),
      width: 120,
      minWidth: 100,
      maxWidth: 140,
      type: 'dateTime',
      sortable: false,
    },
    {
      id: 'actions',
      header: '',
      width: 60,
      minWidth: 50,
      maxWidth: 70,
      align: 'right',
      sortable: false,
      hideable: false,
      resizable: false,
      renderCell: ({ row }) => {
        const summary = summaryByIdRef.current.get(row.id);
        return (
          <RefundActionCell
            transaction={row}
            refundTarget={summary?.refundTarget ?? null}
          />
        );
      },
    },
  ], []);

  const [gridState, setGridState] = useState<DataGridState>(() =>
    createDefaultDataGridState(columns)
  );

  const gridData = useDataSource({
    dataSource,
    columns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  // Populate `summaryByIdRef` from the current rows — the `renderCell`
  // closures read this on every render.
  summaryByIdRef.current = useMemo(
    () => new Map(gridData.rows.map((transaction) => [transaction.id, getTransactionSummary(transaction)])),
    [gridData.rows],
  );

  const filterTypeValue = filters.type ?? "__all";
  const filterCustomerValue = filters.customerType ?? "__all";
  const handleTypeChange = useCallback((value: string) => {
    setFilters((prev) => {
      if (value === "__all") {
        return { ...prev, type: undefined };
      }

      const selectedType = TRANSACTION_TYPES.find((transactionType) => transactionType === value);
      if (selectedType == null) {
        return prev;
      }

      return { ...prev, type: selectedType };
    });
  }, [setFilters]);
  const handleCustomerTypeChange = useCallback((value: string) => {
    setFilters((prev) => {
      if (value === "__all") {
        return { ...prev, customerType: undefined };
      }

      const selectedType = CUSTOMER_TYPE_OPTIONS.find((customerType) => customerType === value);
      if (selectedType == null) {
        return prev;
      }

      return { ...prev, customerType: selectedType };
    });
  }, [setFilters]);

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={getRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}
      rowHeight={56}

      toolbar={(ctx) => (
        <DataGridToolbar
          ctx={ctx}
          hideQuickSearch
          extra={
            <div className="flex items-center gap-2">
              <Select
                value={filterTypeValue}
                onValueChange={handleTypeChange}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All types</SelectItem>
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
                value={filterCustomerValue}
                onValueChange={handleCustomerTypeChange}
              >
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="All customers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All customers</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
      )}
      emptyState={
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground">No transactions found</p>
        </div>
      }
    />
  );
}
