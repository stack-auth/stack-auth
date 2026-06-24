"use client";

import {
  DesignBadge,
  type DesignBadgeColor,
  DesignCard,
} from "@/components/design-components";
import { cn, Skeleton } from "@/components/ui";
import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { UserPageMetricCard } from "@/app/(main)/(protected)/projects/[projectId]/users/[userId]/user-page-metric-card";
import { UserPageTableSection } from "@/app/(main)/(protected)/projects/[projectId]/users/[userId]/user-page-table-section";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, CoinsIcon, GearIcon, ProhibitIcon, QuestionIcon, ShoppingCartIcon, ShuffleIcon } from "@phosphor-icons/react";
import type { DataGridColumnDef } from "@hexclave/dashboard-ui-components";
import type { Transaction, TransactionEntry, TransactionType } from "@hexclave/shared/dist/interface/crud/transactions";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Suspense, useMemo } from "react";
import type { CustomerType } from "./customer-selector";

// Re-export so existing consumers of this module keep working, while the
// canonical definition lives in customer-selector.tsx.
export type { CustomerType };

// Cap for metrics computation. Most customers have well under this; if we hit
// it, the UI shows a banner so the user knows lifetime metrics are bounded.
const METRICS_TRANSACTION_CAP = 1000;

const DATE_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const DATE_LONG = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

type MoneyTransferEntry = Extract<TransactionEntry, { type: "money_transfer" }>;
type ProductGrantEntry = Extract<TransactionEntry, { type: "product_grant" }>;
type ItemQuantityChangeEntry = Extract<TransactionEntry, { type: "item_quantity_change" }>;
type ProductRevocationEntry = Extract<TransactionEntry, { type: "product_revocation" }>;

function isMoneyTransferEntry(entry: TransactionEntry): entry is MoneyTransferEntry {
  return entry.type === "money_transfer";
}
function isProductGrantEntry(entry: TransactionEntry): entry is ProductGrantEntry {
  return entry.type === "product_grant";
}
function isItemQuantityChangeEntry(entry: TransactionEntry): entry is ItemQuantityChangeEntry {
  return entry.type === "item_quantity_change";
}
function isProductRevocationEntry(entry: TransactionEntry): entry is ProductRevocationEntry {
  return entry.type === "product_revocation";
}

function customerNoun(customerType: CustomerType): string {
  return customerType === "custom" ? "customer" : customerType;
}

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) {
    captureError("customer-payments-format-usd-non-finite", new Error(`formatUsd received non-finite amount: ${String(amount)}`));
    return "—";
  }
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTransactionTypeLabel(type: TransactionType | null): { label: string, Icon: PhosphorIcon } {
  switch (type) {
    case "purchase": {
      return { label: "Purchase", Icon: ShoppingCartIcon };
    }
    case "subscription-renewal": {
      return { label: "Subscription renewal", Icon: ArrowClockwiseIcon };
    }
    case "subscription-cancellation": {
      return { label: "Subscription cancellation", Icon: ProhibitIcon };
    }
    case "chargeback": {
      return { label: "Chargeback", Icon: ArrowCounterClockwiseIcon };
    }
    case "manual-item-quantity-change": {
      return { label: "Item quantity change", Icon: GearIcon };
    }
    case "product-change": {
      return { label: "Product change", Icon: ShuffleIcon };
    }
    default: {
      return { label: "-", Icon: QuestionIcon };
    }
  }
}

/**
 * The customer payments view shared by the User detail page, the Team detail
 * page, and the Customers dashboard page. Renders metrics, an active
 * products/subscriptions table, transaction history, and item balances for a
 * single customer identified by (customerType, customerId).
 */
export function CustomerPaymentsSection({ customerType, customerId }: { customerType: CustomerType, customerId: string }) {
  return (
    <Suspense fallback={<CustomerPaymentsLoading />}>
      <CustomerPaymentsContent customerType={customerType} customerId={customerId} />
    </Suspense>
  );
}

function CustomerPaymentsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[64px] rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[180px] rounded-2xl" />
        <Skeleton className="h-[180px] rounded-2xl" />
      </div>
    </div>
  );
}

function CustomerPaymentsContent({ customerType, customerId }: { customerType: CustomerType, customerId: string }) {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();

  const { transactions, nextCursor } = hexclaveAdminApp.useTransactions({
    limit: METRICS_TRANSACTION_CAP,
    customerType,
    customerId,
  });
  const metricsTruncated = nextCursor != null;

  const itemIds = useMemo(
    () =>
      Object.entries(config.payments.items)
        .filter(([, cfg]) => cfg.customerType === customerType)
        .map(([id]) => id),
    [config.payments.items, customerType],
  );

  return (
    <div className="flex flex-col gap-4">
      <MetricsRow customerType={customerType} customerId={customerId} transactions={transactions} truncated={metricsTruncated} />

      <div className="flex flex-col gap-6">
        <ProductsTableSection customerType={customerType} customerId={customerId} transactions={transactions} />
        <TransactionsTableSection customerType={customerType} customerId={customerId} transactions={transactions} />
      </div>

      <ItemsCard customerType={customerType} customerId={customerId} itemIds={itemIds} />
    </div>
  );
}

type ActiveGrant = {
  key: string,
  productDisplayName: string,
  quantity: number,
  subscriptionId: string | undefined,
  grantedAt: Date,
  stackable: boolean,
};

function deriveActiveGrants(transactions: Transaction[], customerType: CustomerType, customerId: string): ActiveGrant[] {
  const revokedRefs = new Set<string>();
  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (isProductRevocationEntry(entry)) {
        revokedRefs.add(`${entry.adjusted_transaction_id}:${entry.adjusted_entry_index}`);
      }
    }
  }

  const cancelledSubscriptionIds = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.type !== "subscription-cancellation") continue;
    for (const entry of transaction.entries) {
      if (isProductRevocationEntry(entry)) {
        const originalTransaction = transactions.find((t) => t.id === entry.adjusted_transaction_id);
        const originalEntry = originalTransaction?.entries[entry.adjusted_entry_index];
        if (originalEntry && isProductGrantEntry(originalEntry) && originalEntry.subscription_id) {
          cancelledSubscriptionIds.add(originalEntry.subscription_id);
        }
      }
    }
  }

  const grants: ActiveGrant[] = [];
  for (const transaction of transactions) {
    transaction.entries.forEach((entry, entryIndex) => {
      if (!isProductGrantEntry(entry)) return;
      if (entry.customer_type !== customerType || entry.customer_id !== customerId) return;
      if (revokedRefs.has(`${transaction.id}:${entryIndex}`)) return;
      if (entry.subscription_id && cancelledSubscriptionIds.has(entry.subscription_id)) return;

      grants.push({
        key: `${transaction.id}:${entryIndex}`,
        productDisplayName: entry.product.display_name,
        quantity: entry.quantity,
        subscriptionId: entry.subscription_id,
        grantedAt: new Date(transaction.effective_at_millis),
        stackable: entry.product.stackable,
      });
    });
  }

  const seenSubscriptions = new Set<string>();
  const deduped: ActiveGrant[] = [];
  for (const grant of grants.sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())) {
    if (grant.subscriptionId) {
      if (seenSubscriptions.has(grant.subscriptionId)) continue;
      seenSubscriptions.add(grant.subscriptionId);
    }
    deduped.push(grant);
  }
  return deduped;
}

function MetricsRow({ customerType, customerId, transactions, truncated }: { customerType: CustomerType, customerId: string, transactions: Transaction[], truncated: boolean }) {
  const activeGrants = useMemo(() => deriveActiveGrants(transactions, customerType, customerId), [transactions, customerType, customerId]);

  const activeSubscriptions = useMemo(
    () => activeGrants.filter((g) => g.subscriptionId != null).length,
    [activeGrants],
  );

  const productsOwned = useMemo(
    () => activeGrants.reduce((sum, g) => sum + (g.stackable ? g.quantity : 1), 0),
    [activeGrants],
  );

  const { lifetimeSpendUsd, payingTransactionCount } = useMemo(() => {
    let total = 0;
    let payingCount = 0;
    for (const transaction of transactions) {
      if (transaction.test_mode) continue;
      let countedThisTxn = false;
      for (const entry of transaction.entries) {
        if (!isMoneyTransferEntry(entry)) continue;
        if (entry.customer_type !== customerType || entry.customer_id !== customerId) continue;
        const usd = entry.net_amount.USD;
        if (typeof usd !== "string") continue;
        const parsed = Number.parseFloat(usd);
        if (Number.isFinite(parsed)) {
          total += parsed;
          countedThisTxn = true;
        }
      }
      if (countedThisTxn) payingCount += 1;
    }
    return { lifetimeSpendUsd: total, payingTransactionCount: payingCount };
  }, [transactions, customerType, customerId]);

  const lifetimeLabel = truncated ? "Recent spend" : "Lifetime spend";
  const lifetimeDescription = payingTransactionCount === 0
    ? "No paying transactions"
    : `Across ${payingTransactionCount} paying transaction${payingTransactionCount === 1 ? "" : "s"}${truncated ? " (recent only)" : ""}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <UserPageMetricCard
          label="Active subscriptions"
          value={activeSubscriptions}
          description={activeSubscriptions === 0 ? "None" : `${activeSubscriptions} running${truncated ? " (recent only)" : ""}`}
          gradient="blue"
        />
        <UserPageMetricCard
          label="Products owned"
          value={productsOwned}
          description={productsOwned === 0 ? "None" : `${activeGrants.length} distinct${truncated ? " (recent only)" : ""}`}
          gradient="purple"
        />
        <UserPageMetricCard
          label={lifetimeLabel}
          value={formatUsd(lifetimeSpendUsd)}
          description={lifetimeDescription}
          gradient="green"
        />
      </div>
      {truncated && (
        <div className="text-xs text-muted-foreground">
          Metrics, active products, and transaction history below reflect only the most recent {METRICS_TRANSACTION_CAP.toLocaleString()} transactions. Older history is excluded.
        </div>
      )}
    </div>
  );
}

function ProductsTableSection({ customerType, customerId, transactions }: { customerType: CustomerType, customerId: string, transactions: Transaction[] }) {
  const grants = useMemo(() => deriveActiveGrants(transactions, customerType, customerId), [transactions, customerType, customerId]);
  const columns = useMemo<DataGridColumnDef<ActiveGrant>[]>(() => [
    {
      id: "productDisplayName",
      accessor: "productDisplayName",
      header: "Product",
      width: 240,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="truncate text-sm font-medium text-foreground">{row.productDisplayName}</span>
      ),
    },
    {
      id: "type",
      header: "Type",
      width: 130,
      sortable: false,
      renderCell: ({ row }) => (
        <DesignBadge
          label={row.subscriptionId ? "Subscription" : "One-time"}
          color={row.subscriptionId ? "blue" : "purple"}
          size="sm"
        />
      ),
    },
    {
      id: "quantity",
      accessor: "quantity",
      header: "Quantity",
      width: 100,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => (
        <span className="font-medium tabular-nums text-foreground">
          {row.stackable ? row.quantity : 1}
        </span>
      ),
    },
    {
      id: "grantedAt",
      accessor: "grantedAt",
      header: "Granted",
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{DATE_SHORT.format(row.grantedAt)}</span>
      ),
    },
  ], []);

  return (
    <UserPageTableSection
      title="Products & subscriptions"
      urlStateKey={`${customerType}subs`}
      columns={columns}
      rows={grants}
      getRowId={(grant) => grant.key}
      emptyLabel={`This ${customerNoun(customerType)} has no active products or subscriptions.`}
    />
  );
}

function transactionSignedUsd(transaction: Transaction, customerType: CustomerType, customerId: string): number | null {
  let total = 0;
  let hadAny = false;
  for (const entry of transaction.entries) {
    if (!isMoneyTransferEntry(entry)) continue;
    if (entry.customer_type !== customerType || entry.customer_id !== customerId) continue;
    const usd = entry.net_amount.USD;
    if (typeof usd !== "string") continue;
    const parsed = Number.parseFloat(usd);
    if (!Number.isFinite(parsed)) continue;
    total += parsed;
    hadAny = true;
  }
  return hadAny ? total : null;
}

function transactionDetail(transaction: Transaction, customerType: CustomerType, customerId: string): string {
  const productGrant = transaction.entries.find(
    (e): e is ProductGrantEntry =>
      isProductGrantEntry(e) && e.customer_type === customerType && e.customer_id === customerId,
  );
  if (productGrant) {
    const name = productGrant.product.display_name;
    return productGrant.quantity > 1 ? `${name} x${productGrant.quantity}` : name;
  }
  const itemChange = transaction.entries.find(
    (e): e is ItemQuantityChangeEntry =>
      isItemQuantityChangeEntry(e) && e.customer_type === customerType && e.customer_id === customerId,
  );
  if (itemChange) {
    const delta = itemChange.quantity;
    return `${itemChange.item_id} (${delta > 0 ? "+" : ""}${delta})`;
  }
  return "-";
}

function TransactionsTableSection({ customerType, customerId, transactions }: { customerType: CustomerType, customerId: string, transactions: Transaction[] }) {
  const ordered = useMemo(
    () => [...transactions].sort((a, b) => b.created_at_millis - a.created_at_millis),
    [transactions],
  );
  const columns = useMemo<DataGridColumnDef<Transaction>[]>(() => [
    {
      id: "type",
      header: "Type",
      width: 190,
      sortable: false,
      renderCell: ({ row }) => {
        const { label, Icon } = formatTransactionTypeLabel(row.type);
        return (
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06]">
              <Icon className="h-4 w-4 text-foreground/70" aria-hidden />
            </div>
            <span className="truncate text-sm font-medium text-foreground">{label}</span>
          </div>
        );
      },
    },
    {
      id: "detail",
      header: "Detail",
      width: 240,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) => (
        <span className="truncate text-sm text-muted-foreground">{transactionDetail(row, customerType, customerId)}</span>
      ),
    },
    {
      id: "createdAt",
      accessor: (transaction) => transaction.created_at_millis,
      header: "Date",
      width: 140,
      sortable: false,
      renderCell: ({ row }) => (
        <span
          className="text-sm text-muted-foreground tabular-nums"
          title={DATE_LONG.format(new Date(row.created_at_millis))}
        >
          {DATE_SHORT.format(new Date(row.created_at_millis))}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      width: 120,
      align: "right",
      sortable: false,
      renderCell: ({ row }) => {
        if (row.test_mode) {
          return <span className="text-xs font-medium text-muted-foreground">Test</span>;
        }
        const signedUsd = transactionSignedUsd(row, customerType, customerId);
        if (signedUsd == null) {
          return <span className="text-xs text-muted-foreground">-</span>;
        }
        return (
          <span
            className={cn(
              "text-sm font-medium tabular-nums",
              signedUsd < 0 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {signedUsd < 0 ? "-" : ""}
            {formatUsd(Math.abs(signedUsd))}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      width: 110,
      sortable: false,
      renderCell: ({ row }) => {
        const badge = transactionStatusBadge(row, row.adjusted_by.length > 0);
        return badge ? <DesignBadge label={badge.label} color={badge.color} size="sm" /> : <span className="text-sm text-muted-foreground">-</span>;
      },
    },
  ], [customerType, customerId]);

  return (
    <UserPageTableSection
      title="Transaction history"
      urlStateKey={`${customerType}txns`}
      columns={columns}
      rows={ordered}
      getRowId={(transaction) => transaction.id}
      emptyLabel={`This ${customerNoun(customerType)} has no transactions.`}
      paginated
    />
  );
}

function transactionStatusBadge(
  transaction: Transaction,
  refunded: boolean,
): { label: string, color: DesignBadgeColor } | null {
  if (refunded) return { label: "Refunded", color: "orange" };
  if (transaction.test_mode) return { label: "Test", color: "purple" };
  return null;
}

function ItemsCard({ customerType, customerId, itemIds }: { customerType: CustomerType, customerId: string, itemIds: string[] }) {
  if (itemIds.length === 0) return null;

  return (
    <DesignCard
      title="Item balances"
      subtitle={`${itemIds.length} ${customerNoun(customerType)}-scoped item${itemIds.length === 1 ? "" : "s"}`}
      icon={CoinsIcon}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
        {itemIds.map((itemId) => (
          <Suspense
            key={itemId}
            fallback={
              <div className="flex items-center justify-between gap-3 py-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-8" />
              </div>
            }
          >
            <ItemBalanceRow customerType={customerType} customerId={customerId} itemId={itemId} />
          </Suspense>
        ))}
      </div>
    </DesignCard>
  );
}

function ItemBalanceRow({ customerType, customerId, itemId }: { customerType: CustomerType, customerId: string, itemId: string }) {
  const hexclaveAdminApp = useAdminApp();
  const itemOptions = customerType === "user"
    ? { userId: customerId, itemId }
    : customerType === "team"
      ? { teamId: customerId, itemId }
      : { customCustomerId: customerId, itemId };
  const item = hexclaveAdminApp.useItem(itemOptions);
  const isNegative = item.quantity < 0;

  return (
    <div className="flex items-center justify-between gap-3 py-1.5" title={itemId}>
      <span className="truncate text-sm text-foreground">{item.displayName}</span>
      <span
        className={`shrink-0 text-sm font-semibold tabular-nums ${isNegative ? "text-destructive" : "text-foreground"}`}
      >
        {item.quantity}
      </span>
    </div>
  );
}
