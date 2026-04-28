"use client";

import {
  DesignBadge,
  type DesignBadgeColor,
  DesignCard,
  DesignMetricCard,
} from "@/components/design-components";
import { Skeleton } from "@/components/ui";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, CoinsIcon, GearIcon, PackageIcon, ProhibitIcon, QuestionIcon, ReceiptIcon, ShoppingCartIcon, ShuffleIcon, StackIcon } from "@phosphor-icons/react";
import type { ServerUser } from "@stackframe/stack";
import type { Transaction, TransactionEntry, TransactionType } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { Suspense, useMemo } from "react";
import { useAdminApp } from "../../use-admin-app";

const TRANSACTIONS_PAGE_SIZE = 100;

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

function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) {
    throwErr("formatUsd received a non-finite amount");
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

export function UserPaymentsSection({ user }: { user: ServerUser }) {
  return (
    <Suspense fallback={<UserPaymentsLoading />}>
      <UserPaymentsContent user={user} />
    </Suspense>
  );
}

function UserPaymentsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-[260px] rounded-2xl" />
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
    </div>
  );
}

function UserPaymentsContent({ user }: { user: ServerUser }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();

  const { transactions: userTransactions } = stackAdminApp.useTransactions({
    limit: TRANSACTIONS_PAGE_SIZE,
    customerType: "user",
    customerId: user.id,
  });

  const userItemIds = useMemo(
    () =>
      Object.entries(config.payments.items)
        .filter(([, cfg]) => cfg.customerType === "user")
        .map(([id]) => id),
    [config.payments.items],
  );

  return (
    <div className="flex flex-col gap-4">
      <MetricsRow userId={user.id} transactions={userTransactions} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProductsCard userId={user.id} transactions={userTransactions} />
        <TransactionsCard userId={user.id} transactions={userTransactions} />
      </div>

      <ItemsCard userId={user.id} itemIds={userItemIds} />
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

function deriveActiveGrants(transactions: Transaction[], userId: string): ActiveGrant[] {
  // Build the set of (transactionId, entryIndex) pairs that have been revoked
  // by a later product_revocation entry. A non-empty revocation means that
  // specific grant was undone (refunded or product-changed away).
  const revokedRefs = new Set<string>();
  for (const transaction of transactions) {
    for (const entry of transaction.entries) {
      if (isProductRevocationEntry(entry)) {
        revokedRefs.add(`${entry.adjusted_transaction_id}:${entry.adjusted_entry_index}`);
      }
    }
  }

  // Any subscription id that appears in a subscription-cancellation
  // transaction is considered cancelled, so we don't show it as active.
  const cancelledSubscriptionIds = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.type !== "subscription-cancellation") continue;
    for (const entry of transaction.entries) {
      if (isProductRevocationEntry(entry)) {
        // The revoked product_grant pointed at by this revocation is the
        // subscription that's being cancelled. We need to resolve that to a
        // subscription_id by looking it up in the original transaction.
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
      if (entry.customer_type !== "user" || entry.customer_id !== userId) return;
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

  // De-dupe subscription grants by subscription_id. Renewals create a fresh
  // product_grant entry each period, but the "product owned" should show once.
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

function MetricsRow({ userId, transactions }: { userId: string, transactions: Transaction[] }) {
  const activeGrants = useMemo(() => deriveActiveGrants(transactions, userId), [transactions, userId]);

  const activeSubscriptions = useMemo(
    () => activeGrants.filter((g) => g.subscriptionId != null).length,
    [activeGrants],
  );

  const productsOwned = useMemo(
    () => activeGrants.reduce((sum, g) => sum + (g.stackable ? g.quantity : 1), 0),
    [activeGrants],
  );

  const lifetimeSpendUsd = useMemo(() => {
    let total = 0;
    for (const transaction of transactions) {
      if (transaction.test_mode) continue;
      if (transaction.adjusted_by.length > 0) continue;
      for (const entry of transaction.entries) {
        if (!isMoneyTransferEntry(entry)) continue;
        if (entry.customer_type !== "user" || entry.customer_id !== userId) continue;
        const usd = entry.net_amount.USD;
        if (typeof usd !== "string") continue;
        const parsed = Number.parseFloat(usd);
        if (Number.isFinite(parsed)) total += parsed;
      }
    }
    return total;
  }, [transactions, userId]);

  const transactionCount = transactions.length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <DesignMetricCard
        label="Active subscriptions"
        value={activeSubscriptions}
        description={activeSubscriptions === 0 ? "None" : `${activeSubscriptions} running`}
        icon={StackIcon}
        gradient="blue"
      />
      <DesignMetricCard
        label="Products owned"
        value={productsOwned}
        description={productsOwned === 0 ? "None" : `${activeGrants.length} distinct`}
        icon={PackageIcon}
        gradient="purple"
      />
      <DesignMetricCard
        label="Lifetime spend"
        value={formatUsd(lifetimeSpendUsd)}
        description={transactionCount === 0 ? "No transactions" : `Across ${transactionCount} transaction${transactionCount === 1 ? "" : "s"}`}
        icon={ReceiptIcon}
        gradient="green"
      />
    </div>
  );
}

function ProductsCard({ userId, transactions }: { userId: string, transactions: Transaction[] }) {
  const grants = useMemo(() => deriveActiveGrants(transactions, userId), [transactions, userId]);

  return (
    <DesignCard
      title="Products & subscriptions"
      subtitle={grants.length === 0 ? "No products granted" : `${grants.length} active`}
      icon={PackageIcon}
    >
      {grants.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <p className="text-sm text-muted-foreground">This user has no active products or subscriptions.</p>
        </div>
      ) : (
        <ul className="divide-y divide-foreground/[0.05]">
          {grants.map((grant) => (
            <li key={grant.key} className="flex items-center gap-3 py-2.5">
              <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {grant.productDisplayName}
                  </span>
                  {grant.stackable && grant.quantity > 1 ? (
                    <span className="shrink-0 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      x{grant.quantity}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  {grant.subscriptionId ? "Subscription - " : "One-time - "}
                  Granted {DATE_SHORT.format(grant.grantedAt)}
                </span>
              </div>
              <DesignBadge
                label={grant.subscriptionId ? "Subscription" : "One-time"}
                color={grant.subscriptionId ? "blue" : "purple"}
                size="sm"
              />
            </li>
          ))}
        </ul>
      )}
    </DesignCard>
  );
}

function transactionSignedUsdForUser(transaction: Transaction, userId: string): number | null {
  let total = 0;
  let hadAny = false;
  for (const entry of transaction.entries) {
    if (!isMoneyTransferEntry(entry)) continue;
    if (entry.customer_type !== "user" || entry.customer_id !== userId) continue;
    const usd = entry.net_amount.USD;
    if (typeof usd !== "string") continue;
    const parsed = Number.parseFloat(usd);
    if (!Number.isFinite(parsed)) continue;
    total += parsed;
    hadAny = true;
  }
  return hadAny ? total : null;
}

function transactionDetailForUser(transaction: Transaction, userId: string): string {
  const productGrant = transaction.entries.find(
    (e): e is ProductGrantEntry =>
      isProductGrantEntry(e) && e.customer_type === "user" && e.customer_id === userId,
  );
  if (productGrant) {
    const name = productGrant.product.display_name;
    return productGrant.quantity > 1 ? `${name} x${productGrant.quantity}` : name;
  }
  const itemChange = transaction.entries.find(
    (e): e is ItemQuantityChangeEntry =>
      isItemQuantityChangeEntry(e) && e.customer_type === "user" && e.customer_id === userId,
  );
  if (itemChange) {
    const delta = itemChange.quantity;
    return `${itemChange.item_id} (${delta > 0 ? "+" : ""}${delta})`;
  }
  return "-";
}

function TransactionsCard({ userId, transactions }: { userId: string, transactions: Transaction[] }) {
  const ordered = useMemo(
    () => [...transactions].sort((a, b) => b.created_at_millis - a.created_at_millis),
    [transactions],
  );

  return (
    <DesignCard
      title="Transaction history"
      subtitle={
        ordered.length === 0
          ? "No transactions recorded"
          : `${ordered.length} most recent`
      }
      icon={ReceiptIcon}
    >
      {ordered.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <p className="text-sm text-muted-foreground">This user has no transactions.</p>
        </div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto -mx-1 px-1">
          <ul className="divide-y divide-foreground/[0.05]">
            {ordered.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} userId={userId} />
            ))}
          </ul>
        </div>
      )}
    </DesignCard>
  );
}

function TransactionRow({ transaction, userId }: { transaction: Transaction, userId: string }) {
  const { label, Icon } = formatTransactionTypeLabel(transaction.type);
  const signedUsd = transactionSignedUsdForUser(transaction, userId);
  const refunded = transaction.adjusted_by.length > 0;
  const detail = transactionDetailForUser(transaction, userId);
  const badge = transactionStatusBadge(transaction, refunded);

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/[0.06]">
        <Icon className="h-4 w-4 text-foreground/70" aria-hidden />
      </div>
      <div className="flex flex-1 min-w-0 flex-col">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          {badge ? <DesignBadge label={badge.label} color={badge.color} size="sm" /> : null}
        </div>
        <span
          className="truncate text-xs text-muted-foreground tabular-nums"
          title={DATE_LONG.format(new Date(transaction.created_at_millis))}
        >
          {DATE_SHORT.format(new Date(transaction.created_at_millis))} - {detail}
        </span>
      </div>
      <div className="text-right">
        {transaction.test_mode ? (
          <span className="text-xs font-medium text-muted-foreground">Test</span>
        ) : signedUsd != null ? (
          <span
            className={`text-sm font-medium tabular-nums ${signedUsd < 0 ? "text-muted-foreground" : "text-foreground"}`}
          >
            {signedUsd < 0 ? "-" : ""}
            {formatUsd(Math.abs(signedUsd))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </div>
    </li>
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

function ItemsCard({ userId, itemIds }: { userId: string, itemIds: string[] }) {
  if (itemIds.length === 0) return null;

  return (
    <DesignCard
      title="Item balances"
      subtitle={`${itemIds.length} user-scoped item${itemIds.length === 1 ? "" : "s"}`}
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
            <ItemBalanceRow userId={userId} itemId={itemId} />
          </Suspense>
        ))}
      </div>
    </DesignCard>
  );
}

function ItemBalanceRow({ userId, itemId }: { userId: string, itemId: string }) {
  const stackAdminApp = useAdminApp();
  const item = stackAdminApp.useItem({ userId, itemId });
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
