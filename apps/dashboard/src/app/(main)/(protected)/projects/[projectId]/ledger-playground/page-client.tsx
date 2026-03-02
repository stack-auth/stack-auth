/* eslint-disable max-statements-per-line */
"use client";

import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Typography,
} from "@/components/ui";
import { notFound } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const stackAppInternalsSymbol = Symbol.for("StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals");

type AdminAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};
type AdminAppWithInternals = ReturnType<typeof useAdminApp> & {
  [stackAppInternalsSymbol]: AdminAppInternals,
};

type Snapshot = {
  at_millis: number,
  owned_products: Array<{ id: string | null, type: string, quantity: number, product: any, source_id: string }>,
  item_quantities: Record<string, number>,
};

type PlaygroundResult = {
  transactions: any[],
  snapshots: Snapshot[],
};

const STORAGE_PREFIX = "stack-ledger-playground:";
function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}
function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    // Ignore storage errors (private mode/quota), keep in-memory state.
  }
}

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randChoice<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function uuid() { return crypto.randomUUID(); }

function generateShuffledData() {
  const spreadDays = randInt(10, 150);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - spreadDays * 86400000);
  function randDate() { return new Date(startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())); }
  function randDateAfter(d: Date) { return new Date(Math.min(d.getTime() + Math.random() * (endDate.getTime() - d.getTime()), endDate.getTime())); }

  const productLineIds = Array.from({ length: randInt(1, 3) }, (_, i) => `line-${i + 1}`);
  const productLines = Object.fromEntries(productLineIds.map((id) => [id, { displayName: id, customerType: "custom" }]));
  const usedItems = ["seats", "credits", "api-calls", "storage-gb", "tokens"].slice(0, randInt(2, 4));

  const products: Record<string, any> = {};
  const productIds: string[] = [];
  for (let i = 0; i < randInt(2, 5); i++) {
    const id = `prod-${i + 1}`;
    productIds.push(id);
    const includedItems: Record<string, any> = {};
    for (let j = 0; j < randInt(1, 3); j++) {
      includedItems[usedItems[j % usedItems.length]] = {
        quantity: randInt(1, 15), repeat: randChoice(["never", [1, "week"], [1, "month"]]),
        expires: randChoice(["never", "when-purchase-expires", "when-repeated"]),
      };
    }
    products[id] = {
      displayName: `Product ${i + 1}`, customerType: "custom", productLineId: randChoice(productLineIds),
      includedItems, prices: { default: { USD: String(randInt(5, 99)), serverOnly: false, interval: [1, "month"] } },
      isAddOnTo: false, serverOnly: false, stackable: randChoice([true, false]),
    };
  }
  for (let i = 0; i < randInt(0, 2); i++) {
    const id = `default-${i + 1}`;
    productIds.push(id);
    products[id] = {
      displayName: `Default ${i + 1}`, customerType: "custom", productLineId: productLineIds[i % productLineIds.length],
      includedItems: { [usedItems[i % usedItems.length]]: { quantity: randInt(1, 3) } },
      prices: "include-by-default", isAddOnTo: false, serverOnly: false, stackable: false,
    };
  }

  const customerId = "playground-customer";
  const paidProductIds = productIds.filter((p) => products[p].prices !== "include-by-default");

  function maybeCreateOlderVersion(product: any): any {
    if (Math.random() > 0.3) return product;
    const old = { ...product, includedItems: { ...product.includedItems } };
    old.displayName = `${product.displayName} (old)`;
    for (const itemId of Object.keys(old.includedItems)) {
      old.includedItems[itemId] = {
        ...old.includedItems[itemId],
        quantity: Math.max(1, old.includedItems[itemId].quantity + randChoice([-2, -1, 1, 3])),
      };
    }
    if (Math.random() < 0.4) {
      const extraItem = randChoice(usedItems);
      if (!(extraItem in old.includedItems)) {
        old.includedItems[extraItem] = { quantity: randInt(1, 5) };
      }
    }
    if (old.prices !== "include-by-default" && old.prices?.default?.USD) {
      old.prices = { ...old.prices, default: { ...old.prices.default, USD: String(Math.max(1, Number(old.prices.default.USD) + randChoice([-10, -5, 5, 15]))) } };
    }
    return old;
  }

  const subscriptions: any[] = [];

  const subScenarios = ["active", "ended", "refunded", ...Array.from({ length: randInt(1, 4) }, () => randChoice(["active", "ended", "refunded", "canceled"]))];
  for (const scenario of subScenarios) {
    const created = randDate();
    const prodId = randChoice(paidProductIds);
    subscriptions.push({
      id: uuid(), tenancyId: "mock-tenancy", customerId, customerType: "CUSTOM",
      productId: prodId, priceId: "default", product: maybeCreateOlderVersion(products[prodId]), quantity: randInt(1, 3),
      stripeSubscriptionId: `stripe-${uuid().slice(0, 8)}`,
      status: scenario === "ended" || scenario === "refunded" ? "canceled" : "active",
      currentPeriodStart: created, currentPeriodEnd: new Date(created.getTime() + 30 * 86400000),
      cancelAtPeriodEnd: scenario === "canceled",
      endedAt: scenario === "ended" ? randDateAfter(created) : null,
      refundedAt: scenario === "refunded" ? randDateAfter(created) : null,
      billingCycleAnchor: created, creationSource: "PURCHASE_PAGE", createdAt: created,
      updatedAt: scenario === "ended" ? randDateAfter(created) : created,
    });
  }

  const oneTimePurchases: any[] = [];
  const otpScenarios = ["active", "refunded", ...Array.from({ length: randInt(0, 2) }, () => randChoice(["active", "refunded"]))];
  for (const scenario of otpScenarios) {
    const created = randDate();
    const prodId = randChoice(paidProductIds);
    oneTimePurchases.push({
      id: uuid(), tenancyId: "mock-tenancy", customerId, customerType: "CUSTOM",
      productId: prodId, priceId: "default", product: maybeCreateOlderVersion(products[prodId]), quantity: randInt(1, 2),
      stripePaymentIntentId: `pi-${uuid().slice(0, 8)}`,
      refundedAt: scenario === "refunded" ? randDateAfter(created) : null,
      creationSource: "PURCHASE_PAGE", createdAt: created, updatedAt: created,
    });
  }

  const itemQuantityChanges = Array.from({ length: randInt(2, 5) }, () => ({
    id: uuid(), tenancyId: "mock-tenancy", customerId, customerType: "CUSTOM",
    itemId: randChoice(usedItems), quantity: randChoice([randInt(1, 30), -randInt(1, 10)]),
    description: null, expiresAt: null, createdAt: randDate(),
  }));

  const subscriptionInvoices: any[] = [];
  for (const sub of subscriptions) {
    if (!sub.stripeSubscriptionId) continue;
    if (!randChoice([true, true, false])) continue;
    const renewalCount = randInt(1, 3);
    for (let i = 0; i < renewalCount; i++) {
      const periodStart = new Date(sub.createdAt.getTime() + (i + 1) * 30 * 86400000);
      if (periodStart > endDate) break;
      const periodEnd = new Date(periodStart.getTime() + 30 * 86400000);
      subscriptionInvoices.push({
        id: uuid(),
        tenancyId: "mock-tenancy",
        stripeSubscriptionId: sub.stripeSubscriptionId,
        stripeInvoiceId: `in_${uuid().slice(0, 12)}`,
        hostedInvoiceUrl: `https://example.com/invoices/${uuid().slice(0, 8)}`,
        isSubscriptionCreationInvoice: false,
        periodStart,
        periodEnd,
        createdAt: randDateAfter(periodStart),
      });
    }
  }

  const defaultProductsSnapshots: any[] = [];
  const defaultProductIds = Object.entries(products).filter(([, p]) => (p as any).prices === "include-by-default").map(([id]) => id);
  function buildSnapshot(ids: string[]) {
    const snap: Record<string, any> = {};
    for (const id of ids) {
      const prod = maybeCreateOlderVersion(products[id]);
      if (!prod) continue;
      snap[id] = {
        display_name: (prod as any).displayName, customer_type: "custom", product_line_id: (prod as any).productLineId,
        included_items: (prod as any).includedItems, prices: {}, server_only: false, stackable: false,
        client_metadata: null, client_read_only_metadata: null, server_metadata: null,
      };
    }
    return snap;
  }
  if (defaultProductIds.length > 0) {
    const numSnapshots = randInt(1, 3);
    for (let si = 0; si < numSnapshots; si++) {
      const subsetSize = si === numSnapshots - 1 ? defaultProductIds.length : randInt(1, defaultProductIds.length);
      const subset = [...defaultProductIds].sort(() => Math.random() - 0.5).slice(0, subsetSize);
      const snapDate = si === 0 ? new Date(startDate.getTime() - 86400000) : randDate();
      defaultProductsSnapshots.push({ id: uuid(), tenancyId: "mock-tenancy", snapshot: buildSnapshot(subset), createdAt: snapDate });
    }
    defaultProductsSnapshots.sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  return {
    config: { products, productLines, items: Object.fromEntries(usedItems.map((id) => [id, { displayName: id, customerType: "custom" }])) },
    db: { subscriptions, oneTimePurchases, itemQuantityChanges, subscriptionInvoices, defaultProductsSnapshots },
    customerId, startMillis: startDate.getTime(), endMillis: endDate.getTime(),
  };
}

const LABEL_W = 100;
const ROW_H = 36;

function getRelatedTxIds(tx: any, allTxs: any[]): Set<string> {
  const ids = new Set<string>();
  ids.add(tx.id);
  if (tx.details?.source_transaction_id) ids.add(tx.details.source_transaction_id);
  for (const adj of tx.adjusted_by ?? []) ids.add(adj.transaction_id);
  for (const entry of tx.entries ?? []) {
    if (entry.adjusted_transaction_id) ids.add(entry.adjusted_transaction_id);
  }
  for (const other of allTxs) {
    if (other.details?.source_transaction_id === tx.id) ids.add(other.id);
    for (const adj of other.adjusted_by ?? []) {
      if (adj.transaction_id === tx.id) ids.add(other.id);
    }
    for (const entry of other.entries ?? []) {
      if (entry.adjusted_transaction_id === tx.id) ids.add(other.id);
    }
  }
  return ids;
}

function shortType(type: string) {
  return type.replace("subscription-", "sub-").replace("manual-item-quantity-", "iqc-").replace("one-time-", "otp-").replace("default-products-", "def-").replace("item-grant-", "igr-");
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getProductLineIdFromInlineProduct(product: any): string | null {
  if (typeof product?.product_line_id === "string") return product.product_line_id;
  if (typeof product?.productLineId === "string") return product.productLineId;
  return null;
}

function formatRepeat(repeat: unknown): string {
  if (repeat === "never" || repeat == null) return "once";
  if (Array.isArray(repeat) && repeat.length === 2) {
    const [n, unit] = repeat;
    if (typeof n === "number" && typeof unit === "string") return `${n} ${unit}`;
  }
  return "custom";
}

function formatIncludedItemsSummary(product: any): string[] {
  const includedItems = (product?.included_items ?? product?.includedItems ?? {}) as Record<string, any>;
  const parts = Object.entries(includedItems).map(([itemId, cfg]) => {
    const qty = Number(cfg?.quantity ?? 0);
    const repeat = formatRepeat(cfg?.repeat ?? "never");
    const expires = String(cfg?.expires ?? "never");
    return `${qty}x ${itemId} / ${repeat} (${expires})`;
  });
  return parts;
}

function detectProductVersionDrift(snapshotProduct: any, configProduct: any): string[] {
  if (!snapshotProduct || !configProduct) return [];
  const diffs: string[] = [];
  const snapItems = snapshotProduct.included_items ?? snapshotProduct.includedItems ?? {};
  const configItems = configProduct.includedItems ?? configProduct.included_items ?? {};
  const allKeys = new Set([...Object.keys(snapItems), ...Object.keys(configItems)]);
  for (const key of allKeys) {
    const snapQty = Number(snapItems[key]?.quantity ?? 0);
    const cfgQty = Number(configItems[key]?.quantity ?? 0);
    if (snapQty !== cfgQty) {
      diffs.push(`${key}: ${snapQty} (was) -> ${cfgQty} (now)`);
    }
    if ((key in snapItems) !== (key in configItems)) {
      if (!(key in configItems)) diffs.push(`${key}: removed in config`);
      else diffs.push(`${key}: added in config`);
    }
  }
  const snapName = snapshotProduct.display_name ?? snapshotProduct.displayName;
  const cfgName = configProduct.displayName ?? configProduct.display_name;
  if (snapName && cfgName && snapName !== cfgName) {
    diffs.push(`name: "${snapName}" -> "${cfgName}"`);
  }
  return diffs;
}

function getRelatedTxIdsForRow(
  rowType: "product" | "item",
  rowId: string,
  transactions: any[],
): Set<string> {
  const txIdsWithProductGrant = new Map<string, string>();
  for (const tx of transactions) {
    for (const entry of tx.entries ?? []) {
      if (entry.type === "product-grant" && entry.product_id === rowId) {
        txIdsWithProductGrant.set(tx.id, rowId);
      }
    }
  }

  const ids = new Set<string>();
  for (const tx of transactions) {
    for (const entry of tx.entries ?? []) {
      if (rowType === "product") {
        if (entry.type === "product-grant" && entry.product_id === rowId) { ids.add(tx.id); break; }
        if (entry.type === "product-revocation" && txIdsWithProductGrant.has(entry.adjusted_transaction_id)) { ids.add(tx.id); break; }
        if (entry.type === "active-subscription-start" && entry.product_id === rowId) { ids.add(tx.id); break; }
        if (entry.type === "active-subscription-stop") {
          const subId = entry.subscription_id;
          if (subId && transactions.some((t) => t.entries?.some((e: any) => e.type === "active-subscription-start" && e.subscription_id === subId && e.product_id === rowId))) {
            ids.add(tx.id); break;
          }
        }
        if ((entry.type === "item-quantity-change" || entry.type === "item-quantity-expire") && tx.type === "item-grant-renewal" && tx.details?.source_transaction_id && txIdsWithProductGrant.has(tx.details.source_transaction_id)) {
          ids.add(tx.id); break;
        }
      } else {
        if ((entry.type === "item-quantity-change" || entry.type === "item-quantity-expire") && entry.item_id === rowId) { ids.add(tx.id); break; }
      }
    }
  }
  return ids;
}

function TimelineView({ result, configProducts }: { result: PlaygroundResult, configProducts: Record<string, any> }) {
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [hoveredTxId, setHoveredTxId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [viewStart, setViewStart] = useState<number | null>(null);
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<{ type: "product" | "item", id: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { transactions, snapshots } = result;
  const dataMin = snapshots.length > 0
    ? Math.min(...snapshots.map((s) => s.at_millis), ...transactions.map((t) => t.effective_at_millis))
    : 0;
  const dataMax = snapshots.length > 0
    ? Math.max(...snapshots.map((s) => s.at_millis), ...transactions.map((t) => t.effective_at_millis))
    : 0;
  const vStart = viewStart ?? dataMin;
  const vEnd = viewEnd ?? dataMax;
  const vRange = vEnd - vStart || 1;
  const nowMillis = Date.now();

  const allProductIds = new Set<string>();
  const allItemIds = new Set<string>();
  for (const snap of snapshots) {
    for (const p of snap.owned_products) allProductIds.add(p.id ?? "inline");
    for (const itemId of Object.keys(snap.item_quantities)) allItemIds.add(itemId);
  }
  const productIdList = [...allProductIds];
  const itemIdList = [...allItemIds];
  const maxItemQty = Math.max(1, ...snapshots.flatMap((s) => Object.values(s.item_quantities)));
  const maxProductQty = Math.max(1, ...snapshots.map((s) => {
    const totals = new Map<string, number>();
    for (const p of s.owned_products) {
      const key = p.id ?? "inline";
      totals.set(key, (totals.get(key) ?? 0) + p.quantity);
    }
    return Math.max(0, ...totals.values());
  }));
  const totalRows = productIdList.length + itemIdList.length;

  const selectedTx = transactions.find((t) => t.id === selectedTxId) ?? null;
  const hoveredTx = transactions.find((t) => t.id === hoveredTxId) ?? null;

  const rowHighlightIds = useMemo(() => {
    if (!hoveredRow) return new Set<string>();
    return getRelatedTxIdsForRow(hoveredRow.type, hoveredRow.id, transactions);
  }, [hoveredRow, transactions]);

  const highlightIds = useMemo(() => {
    if (selectedTx) return getRelatedTxIds(selectedTx, transactions);
    if (hoveredTx) return getRelatedTxIds(hoveredTx, transactions);
    if (hoveredRow) return rowHighlightIds;
    return new Set<string>();
  }, [selectedTx, hoveredTx, hoveredRow, rowHighlightIds, transactions]);

  function timeToPercent(ms: number) { return ((ms - vStart) / vRange) * 100; }

  const handleWheelRef = useRef<(e: WheelEvent) => void>();
  handleWheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseXRatio = Math.max(0, Math.min(1, (e.clientX - rect.left - LABEL_W) / (rect.width - LABEL_W)));
    const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const curStart = viewStart ?? dataMin;
    const curEnd = viewEnd ?? dataMax;
    const curRange = curEnd - curStart;
    const mouseTime = curStart + mouseXRatio * curRange;
    const newRange = Math.max(60000, curRange * zoomFactor);
    setViewStart(mouseTime - mouseXRatio * newRange);
    setViewEnd(mouseTime + (1 - mouseXRatio) * newRange);
  };
  const wheelListenerAttached = useRef(false);
  if (containerRef.current && wheelListenerAttached.current === false) {
    const el = containerRef.current;
    el.addEventListener("wheel", (e) => handleWheelRef.current?.(e), { passive: false });
    wheelListenerAttached.current = true;
  }

  function getMergedSegments<T>(getId: (snap: Snapshot) => T | null) {
    const segments: Array<{ value: T, startMs: number, endMs: number }> = [];
    for (let i = 0; i + 1 < snapshots.length; i++) {
      const val = getId(snapshots[i]);
      if (val === null) continue;
      const nextSnap = snapshots[i + 1];
      const last = segments.length > 0 ? segments[segments.length - 1] : null;
      if (last !== null && JSON.stringify(last.value) === JSON.stringify(val) && last.endMs === snapshots[i].at_millis) {
        last.endMs = nextSnap.at_millis;
      } else {
        segments.push({ value: val, startMs: snapshots[i].at_millis, endMs: nextSnap.at_millis });
      }
    }
    return segments;
  }

  if (snapshots.length === 0) return <Typography variant="secondary">No data.</Typography>;

  return (
    <div className="space-y-2">
      {selectedTx && (
        <div className="rounded border border-muted bg-muted/30 p-2 text-xs">
          <div className="flex justify-between items-start mb-1">
            <span className="font-mono font-bold">{selectedTx.type}
              {selectedTx.details?.source_transaction_id && <span className="font-normal text-muted-foreground"> (from {selectedTx.details.source_transaction_id.slice(0, 12)}...)</span>}
              {selectedTx.details?.default_product_id && <span className="font-normal text-muted-foreground"> (default: {selectedTx.details.default_product_id})</span>}
              <span className="font-normal text-muted-foreground ml-2">@ {formatDate(selectedTx.effective_at_millis)}</span>
            </span>
            <button className="text-muted-foreground hover:text-foreground ml-2" onClick={() => setSelectedTxId(null)}>close</button>
          </div>
          <pre className="text-[10px] max-h-48 overflow-auto bg-background p-2 rounded border">{JSON.stringify(selectedTx.entries, null, 2)}</pre>
        </div>
      )}
      {selectedProduct && (
        <div className="rounded border border-muted bg-muted/30 p-2 text-xs">
          <div className="flex justify-between items-start mb-1">
            <span className="font-mono font-bold">Product: {selectedProduct.id ?? "inline"} ({selectedProduct.type})</span>
            <button className="text-muted-foreground hover:text-foreground ml-2" onClick={() => setSelectedProduct(null)}>close</button>
          </div>
          <pre className="text-[10px] max-h-48 overflow-auto bg-background p-2 rounded border">{JSON.stringify(selectedProduct.product, null, 2)}</pre>
        </div>
      )}

      <div ref={containerRef} className="relative border rounded bg-background select-none" style={{ height: totalRows * ROW_H + 40 }}>
        <div className="flex items-center h-6 border-b text-[10px] text-muted-foreground" style={{ paddingLeft: LABEL_W }}>
          <span>{formatDate(vStart)}</span>
          <span className="mx-auto text-[9px] opacity-50">scroll to zoom</span>
          <span>{formatDate(vEnd)}</span>
        </div>

        <div className="relative" style={{ height: totalRows * ROW_H }}>
          {(() => {
            const pct = timeToPercent(nowMillis);
            if (pct < -2 || pct > 102) return null;
            return (
              <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: `calc(${LABEL_W}px + ${pct / 100} * (100% - ${LABEL_W}px))` }}>
                <div className="absolute inset-0 border-l-2 border-green-500/60" />
                <span className="absolute -top-0.5 left-1 text-[8px] font-bold text-green-600 dark:text-green-400">NOW</span>
              </div>
            );
          })()}

          {transactions.map((tx, i) => {
            const pct = timeToPercent(tx.effective_at_millis);
            if (pct < -5 || pct > 105) return null;
            const isHighlighted = highlightIds.has(tx.id);
            const isSelected = tx.id === selectedTxId;
            return (
              <div key={`txline-${i}`} className="absolute top-0 bottom-0 cursor-pointer z-10 group"
                style={{ left: `calc(${LABEL_W}px + ${pct / 100} * (100% - ${LABEL_W}px))`, width: 1 }}
                onClick={() => setSelectedTxId(tx.id === selectedTxId ? null : tx.id)}
                onMouseEnter={() => setHoveredTxId(tx.id)}
                onMouseLeave={() => setHoveredTxId(null)}>
                <div className={`absolute inset-0 border-l border-dashed transition-colors hover:transition-none ${isHighlighted || isSelected ? "border-foreground/70 border-solid" : "border-muted-foreground/20 group-hover:border-foreground/50"}`} />
                <span className={`absolute top-0 left-1 text-[7px] whitespace-nowrap origin-bottom-left -rotate-45 transition-colors hover:transition-none ${isHighlighted || isSelected ? "text-foreground font-bold" : "text-muted-foreground/50 group-hover:text-foreground"}`}>
                  {shortType(tx.type)}
                </span>
              </div>
            );
          })}

          {/* Cycle anchor markers for hovered/selected transactions with product-grant entries */}
          {(() => {
            const activeTx = selectedTx ?? hoveredTx;
            if (!activeTx) return null;
            const anchors: Array<{ millis: number, productId: string | null }> = [];
            for (const entry of activeTx.entries ?? []) {
              if (entry.type === "product-grant" && entry.cycle_anchor) {
                anchors.push({ millis: entry.cycle_anchor, productId: entry.product_id });
              }
            }
            return anchors.map((a, ai) => {
              const pct = timeToPercent(a.millis);
              if (pct < -5 || pct > 105) return null;
              return (
                <div key={`anchor-${ai}`} className="absolute top-0 bottom-0 z-15 pointer-events-none"
                  style={{ left: `calc(${LABEL_W}px + ${pct / 100} * (100% - ${LABEL_W}px))` }}>
                  <div className="absolute inset-0 border-l border-dotted border-amber-500/60" />
                  <span className="absolute -top-0.5 left-1 text-[7px] font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                    anchor{a.productId ? ` (${a.productId})` : ""}
                  </span>
                </div>
              );
            });
          })()}

          {/* Product rows with quantity-proportional height */}
          {productIdList.map((productId) => {
            const segments = getMergedSegments((snap) => {
              const matching = snap.owned_products.filter((p) => (p.id ?? "inline") === productId);
              if (matching.length === 0) return null;
              const totalQty = matching.reduce((sum, p) => sum + p.quantity, 0);
              return { qty: totalQty, type: matching[0].type, count: matching.length };
            });
            const isRowHovered = hoveredRow?.type === "product" && hoveredRow.id === productId;
            return (
              <div key={`p-${productId}`} className="flex items-stretch border-b border-muted/50" style={{ height: ROW_H }}>
                <div
                  className={`shrink-0 flex items-center text-[10px] font-mono truncate px-2 text-red-600 dark:text-red-400 border-r border-muted/50 cursor-pointer transition-colors hover:transition-none ${isRowHovered ? "bg-red-500/15" : "bg-muted/20 hover:bg-red-500/10"}`}
                  style={{ width: LABEL_W }}
                  onMouseEnter={() => setHoveredRow({ type: "product", id: productId })}
                  onMouseLeave={() => setHoveredRow(null)}
                >{productId}</div>
                <div className="flex-1 relative">
                  {segments.map((seg, si) => {
                    const x1 = timeToPercent(seg.startMs);
                    const x2 = timeToPercent(seg.endMs);
                    if (x2 < -5 || x1 > 105) return null;
                    const qty = (seg.value as any).qty;
                    const barH = Math.max(8, (qty / maxProductQty) * (ROW_H - 4));
                    const snap = snapshots.find((s) => s.at_millis >= seg.startMs);
                    const owned = snap?.owned_products.find((p) => (p.id ?? "inline") === productId);
                    const productLineId = getProductLineIdFromInlineProduct(owned?.product);
                    const itemLines = formatIncludedItemsSummary(owned?.product);
                    const versionDrift = detectProductVersionDrift(owned?.product, configProducts[productId]);
                    return (
                      <Tooltip key={si}>
                        <TooltipTrigger asChild>
                          <div
                            className="absolute bottom-0.5 bg-red-500/20 dark:bg-red-400/12 border border-red-500/30 border-b-0 rounded-t-sm cursor-pointer hover:bg-red-500/35 transition-colors hover:transition-none"
                            style={{ left: `${x1}%`, width: `${Math.max(0.3, x2 - x1)}%`, height: barH }}
                            onClick={() => {
                              if (owned) setSelectedProduct(owned);
                            }}
                          >
                            {(x2 - x1) > 3 && <span className="text-[8px] text-red-700 dark:text-red-300 px-0.5 leading-none">{qty}</span>}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[420px] text-[10px] font-mono p-2 space-y-0.5">
                          <div className="font-bold">{productId} qty={qty}</div>
                          <div className="text-muted-foreground">type: {(seg.value as any).type}{(seg.value as any).count > 1 ? ` (x${(seg.value as any).count} sources)` : ""}</div>
                          <div className="text-muted-foreground">line: {productLineId ?? "none"}</div>
                          {itemLines.length > 0 ? (
                            <div className="text-muted-foreground">
                              <span>items:</span>
                              {itemLines.map((line, li) => <div key={li} className="ml-2">{line}</div>)}
                            </div>
                          ) : (
                            <div className="text-muted-foreground">items: none</div>
                          )}
                          {versionDrift.length > 0 && (
                            <div className="text-amber-500 dark:text-amber-400 border-t border-muted pt-0.5 mt-0.5">
                              <div className="font-semibold">product version differs from config:</div>
                              {versionDrift.map((d, di) => <div key={di} className="ml-2">{d}</div>)}
                            </div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {productIdList.length > 0 && itemIdList.length > 0 && <div className="h-0 border-b-2 border-muted" />}

          {/* Item rows */}
          {itemIdList.map((itemId) => {
            const segments = getMergedSegments((snap) => {
              const qty = snap.item_quantities[itemId] ?? 0;
              return qty !== 0 ? qty : null;
            });
            const isRowHovered = hoveredRow?.type === "item" && hoveredRow.id === itemId;
            return (
              <div key={`i-${itemId}`} className="flex items-stretch border-b border-muted/50" style={{ height: ROW_H }}>
                <div
                  className={`shrink-0 flex items-center text-[10px] font-mono truncate px-2 text-blue-600 dark:text-blue-400 border-r border-muted/50 cursor-pointer transition-colors hover:transition-none ${isRowHovered ? "bg-blue-500/15" : "bg-muted/20 hover:bg-blue-500/10"}`}
                  style={{ width: LABEL_W }}
                  onMouseEnter={() => setHoveredRow({ type: "item", id: itemId })}
                  onMouseLeave={() => setHoveredRow(null)}
                >{itemId}</div>
                <div className="flex-1 relative">
                  {segments.map((seg, si) => {
                    const x1 = timeToPercent(seg.startMs);
                    const x2 = timeToPercent(seg.endMs);
                    if (x2 < -5 || x1 > 105) return null;
                    const qty = seg.value as number;
                    const barH = Math.max(6, (Math.abs(qty) / maxItemQty) * (ROW_H - 6));
                    return (
                      <div key={si}
                        className={`absolute bottom-0 border border-b-0 rounded-t-sm ${qty >= 0 ? "bg-blue-500/20 dark:bg-blue-400/12 border-blue-500/30" : "bg-orange-500/20 dark:bg-orange-400/12 border-orange-500/30"}`}
                        style={{ left: `${x1}%`, width: `${Math.max(0.3, x2 - x1)}%`, height: barH }}
                        title={`${itemId} = ${qty}`}>
                        {(x2 - x1) > 3 && <span className={`text-[8px] px-0.5 leading-none ${qty >= 0 ? "text-blue-700 dark:text-blue-300" : "text-orange-700 dark:text-orange-300"}`}>{qty}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {(viewStart !== null || viewEnd !== null) && (
          <button className="absolute top-1 right-1 text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground z-20"
            onClick={() => { setViewStart(null); setViewEnd(null); }}>reset zoom</button>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">All transactions ({transactions.length})</summary>
        <div className="mt-1 max-h-60 overflow-auto border rounded divide-y">
          {transactions.map((tx) => {
            const isHighlighted = highlightIds.has(tx.id);
            const isSelected = tx.id === selectedTxId;
            return (
              <div key={tx.id}
                className={`flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-muted/50 transition-colors hover:transition-none ${isSelected ? "bg-muted" : isHighlighted ? "bg-muted/30" : ""}`}
                onClick={() => setSelectedTxId(tx.id === selectedTxId ? null : tx.id)}
                onMouseEnter={() => setHoveredTxId(tx.id)}
                onMouseLeave={() => setHoveredTxId(null)}>
                <span className="font-mono text-muted-foreground w-32 shrink-0 truncate">{formatDate(tx.effective_at_millis)}</span>
                <span className="font-mono font-medium w-28 shrink-0">{shortType(tx.type)}</span>
                <span className="font-mono text-muted-foreground truncate">{tx.id.slice(0, 20)}{tx.id.length > 20 ? "..." : ""}</span>
                {tx.details?.source_transaction_id && <span className="text-muted-foreground/60 shrink-0">src:{tx.details.source_transaction_id.slice(0, 8)}...</span>}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

// ── Table-based Mock DB Editor ──

type FieldDef = {
  name: string,
  type: "string" | "number" | "boolean" | "date" | "date?" | "json" | "enum",
  options?: string[],
  width?: number,
  hidden?: boolean,
};

const SUB_FIELDS: FieldDef[] = [
  { name: "id", type: "string", width: 80 },
  { name: "tenancyId", type: "string", width: 80, hidden: true },
  { name: "customerId", type: "string", width: 100 },
  { name: "customerType", type: "enum", options: ["CUSTOM", "USER", "TEAM"], width: 70 },
  { name: "productId", type: "string", width: 80 },
  { name: "priceId", type: "string", width: 60 },
  { name: "product", type: "json", width: 80 },
  { name: "quantity", type: "number", width: 40 },
  { name: "stripeSubscriptionId", type: "string", width: 100 },
  { name: "status", type: "enum", options: ["active", "canceled", "past_due", "unpaid"], width: 70 },
  { name: "currentPeriodStart", type: "date", width: 130 },
  { name: "currentPeriodEnd", type: "date", width: 130 },
  { name: "cancelAtPeriodEnd", type: "boolean", width: 50 },
  { name: "endedAt", type: "date?", width: 130 },
  { name: "refundedAt", type: "date?", width: 130 },
  { name: "billingCycleAnchor", type: "date", width: 130 },
  { name: "creationSource", type: "enum", options: ["PURCHASE_PAGE", "TEST_MODE"], width: 100 },
  { name: "createdAt", type: "date", width: 130 },
  { name: "updatedAt", type: "date", width: 130 },
];

const OTP_FIELDS: FieldDef[] = [
  { name: "id", type: "string", width: 80 },
  { name: "tenancyId", type: "string", width: 80, hidden: true },
  { name: "customerId", type: "string", width: 100 },
  { name: "customerType", type: "enum", options: ["CUSTOM", "USER", "TEAM"], width: 70 },
  { name: "productId", type: "string", width: 80 },
  { name: "priceId", type: "string", width: 60 },
  { name: "product", type: "json", width: 80 },
  { name: "quantity", type: "number", width: 40 },
  { name: "stripePaymentIntentId", type: "string", width: 100 },
  { name: "refundedAt", type: "date?", width: 130 },
  { name: "creationSource", type: "enum", options: ["PURCHASE_PAGE", "TEST_MODE"], width: 100 },
  { name: "createdAt", type: "date", width: 130 },
  { name: "updatedAt", type: "date", width: 130 },
];

const IQC_FIELDS: FieldDef[] = [
  { name: "id", type: "string", width: 80 },
  { name: "tenancyId", type: "string", width: 80, hidden: true },
  { name: "customerId", type: "string", width: 100 },
  { name: "customerType", type: "enum", options: ["CUSTOM", "USER", "TEAM"], width: 70 },
  { name: "itemId", type: "string", width: 80 },
  { name: "quantity", type: "number", width: 60 },
  { name: "description", type: "string", width: 100 },
  { name: "expiresAt", type: "date?", width: 130 },
  { name: "createdAt", type: "date", width: 130 },
];

const DPS_FIELDS: FieldDef[] = [
  { name: "id", type: "string", width: 80 },
  { name: "tenancyId", type: "string", width: 80, hidden: true },
  { name: "snapshot", type: "json", width: 200 },
  { name: "createdAt", type: "date", width: 130 },
];

const INVOICE_FIELDS: FieldDef[] = [
  { name: "id", type: "string", width: 80 },
  { name: "tenancyId", type: "string", width: 80, hidden: true },
  { name: "stripeSubscriptionId", type: "string", width: 120 },
  { name: "stripeInvoiceId", type: "string", width: 120 },
  { name: "hostedInvoiceUrl", type: "string", width: 120 },
  { name: "isSubscriptionCreationInvoice", type: "boolean", width: 60 },
  { name: "periodStart", type: "date", width: 130 },
  { name: "periodEnd", type: "date", width: 130 },
  { name: "createdAt", type: "date", width: 130 },
];

const TABLE_DEFS: Array<{ key: string, label: string, fields: FieldDef[] }> = [
  { key: "subscriptions", label: "Subscriptions", fields: SUB_FIELDS },
  { key: "oneTimePurchases", label: "One-Time Purchases", fields: OTP_FIELDS },
  { key: "itemQuantityChanges", label: "Item Qty Changes", fields: IQC_FIELDS },
  { key: "subscriptionInvoices", label: "Invoices", fields: INVOICE_FIELDS },
  { key: "defaultProductsSnapshots", label: "Default Products", fields: DPS_FIELDS },
];

function makeDefaultRow(fields: FieldDef[], customerId: string): Record<string, any> {
  const row: Record<string, any> = {};
  const now = new Date();
  for (const f of fields) {
    switch (f.type) {
      case "string": {
        row[f.name] = f.name === "id" ? uuid() : f.name === "tenancyId" ? "mock-tenancy" : f.name === "customerId" ? customerId : "";
        break;
      }
      case "number": {
        row[f.name] = f.name === "quantity" ? 1 : 0;
        break;
      }
      case "boolean": {
        row[f.name] = false;
        break;
      }
      case "date": {
        row[f.name] = now.toISOString();
        break;
      }
      case "date?": {
        row[f.name] = null;
        break;
      }
      case "json": {
        row[f.name] = {};
        break;
      }
      case "enum": {
        row[f.name] = f.options?.[0] ?? "";
        break;
      }
    }
  }
  return row;
}

function toDateInputVal(val: any): string {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function CellEditor({ field, value, onChange }: { field: FieldDef, value: any, onChange: (v: any) => void }) {
  const cls = "h-6 w-full rounded border border-input bg-transparent px-1 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring";

  switch (field.type) {
    case "string": {
      return <input className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
    }
    case "number": {
      return <input className={cls} type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />;
    }
    case "boolean": {
      return <input type="checkbox" className="h-4 w-4" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    }
    case "date": {
      return <input className={cls} type="datetime-local" value={toDateInputVal(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : new Date().toISOString())} />;
    }
    case "date?": {
      return (
        <div className="flex items-center gap-0.5">
          <input className={`${cls} flex-1`} type="datetime-local" value={toDateInputVal(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
          {value && <button className="text-[9px] text-muted-foreground hover:text-destructive shrink-0" onClick={() => onChange(null)} title="Clear">×</button>}
        </div>
      );
    }
    case "enum": {
      return (
        <select className={cls} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case "json": {
      return <JsonCellEditor value={value} onChange={onChange} />;
    }
    default: {
      return null;
    }
  }
}

function JsonCellEditor({ value, onChange }: { value: any, onChange: (v: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));

  if (editing) {
    return (
      <div className="absolute z-30 top-0 left-0 right-0 bg-background border rounded shadow-lg p-1">
        <textarea className="w-full h-32 text-[10px] font-mono border rounded p-1 resize-y bg-transparent" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-1 mt-0.5">
          <button className="text-[9px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground" onClick={() => {
            try {
              onChange(JSON.parse(text));
              setEditing(false);
            } catch {
              // invalid json
            }
          }}>Save</button>
          <button className="text-[9px] px-1.5 py-0.5 rounded bg-muted" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  const preview = JSON.stringify(value ?? {}).slice(0, 30);
  return (
    <button className="text-[10px] font-mono text-muted-foreground hover:text-foreground text-left truncate w-full" onClick={() => {
      setText(JSON.stringify(value ?? {}, null, 2));
      setEditing(true);
    }}>
      {preview}
      {preview.length >= 30 ? "…" : ""}
    </button>
  );
}

function MockDbTableEditor({ dbJson, onChange, customerId }: { dbJson: string, onChange: (json: string) => void, customerId: string }) {
  const [activeTab, setActiveTab] = useState(TABLE_DEFS[0].key);

  let db: Record<string, any[]>;
  try { db = JSON.parse(dbJson); } catch { db = {}; }

  function updateDb(newDb: Record<string, any[]>) {
    onChange(JSON.stringify(newDb, null, 2));
  }

  function updateRow(tableKey: string, rowIdx: number, field: string, value: any) {
    const table = [...(db[tableKey] ?? [])];
    table[rowIdx] = { ...table[rowIdx], [field]: value };
    updateDb({ ...db, [tableKey]: table });
  }

  function addRow(tableKey: string, fields: FieldDef[]) {
    const table = [...(db[tableKey] ?? [])];
    table.push(makeDefaultRow(fields, customerId));
    updateDb({ ...db, [tableKey]: table });
  }

  function deleteRow(tableKey: string, rowIdx: number) {
    const table = [...(db[tableKey] ?? [])];
    table.splice(rowIdx, 1);
    updateDb({ ...db, [tableKey]: table });
  }

  const def = TABLE_DEFS.find((t) => t.key === activeTab);
  const visibleFields = def ? def.fields.filter((f) => !f.hidden) : [];
  const rows: any[] = db[activeTab] ?? [];

  return (
    <div className="border rounded bg-muted/5">
      <div className="flex items-center border-b overflow-x-auto">
        {TABLE_DEFS.map((t) => (
          <button key={t.key}
            className={`px-3 py-1.5 text-[10px] font-medium whitespace-nowrap border-b-2 transition-colors hover:transition-none ${activeTab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab(t.key)}>
            {t.label} ({(db[t.key] ?? []).length})
          </button>
        ))}
      </div>
      {def && (
        <div className="overflow-x-auto">
          <table className="text-[10px] border-collapse min-w-full">
            <thead>
              <tr>
                <th className="sticky left-0 bg-muted/40 z-10 w-6 border-b" />
                {visibleFields.map((f) => (
                  <th key={f.name} className="px-1 py-1 border-b text-left font-medium text-muted-foreground whitespace-nowrap" style={{ minWidth: f.width }}>
                    {f.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="group hover:bg-muted/20">
                  <td className="sticky left-0 bg-background z-10 border-b px-0.5 text-center">
                    <button className="text-muted-foreground/40 group-hover:text-destructive text-xs" onClick={() => deleteRow(activeTab, ri)} title="Delete row">×</button>
                  </td>
                  {visibleFields.map((f) => (
                    <td key={f.name} className="px-1 py-0.5 border-b relative" style={{ minWidth: f.width }}>
                      <CellEditor field={f} value={row[f.name]} onChange={(v) => updateRow(activeTab, ri, f.name, v)} />
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={visibleFields.length + 1} className="text-center py-3 text-muted-foreground">No rows</td></tr>
              )}
            </tbody>
          </table>
          <div className="p-1 border-t">
            <button className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground" onClick={() => addRow(activeTab, def.fields)}>+ Add Row</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp() as AdminAppWithInternals;
  const [mode, setMode] = useState<"live" | "mock">(() => {
    const stored = readLocalStorage("mode");
    return stored === "live" || stored === "mock" ? stored : "mock";
  });
  const [tenancyId, setTenancyId] = useState(() => readLocalStorage("tenancyId") ?? "");
  const [customerType, setCustomerType] = useState<"user" | "team" | "custom">(() => {
    const stored = readLocalStorage("customerType");
    return stored === "user" || stored === "team" || stored === "custom" ? stored : "custom";
  });
  const [customerId, setCustomerId] = useState(() => readLocalStorage("customerId") ?? "playground-customer");
  const [startDate, setStartDate] = useState(() => {
    const stored = readLocalStorage("startDate");
    if (stored) return stored;
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 16);
  });
  const [endDate, setEndDate] = useState(() => readLocalStorage("endDate") ?? new Date().toISOString().slice(0, 16));
  const [mockConfigJson, setMockConfigJson] = useState(() => readLocalStorage("mockConfigJson") ?? "{}");
  const [mockDbJson, setMockDbJson] = useState(() => readLocalStorage("mockDbJson") ?? "{}");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => readLocalStorage("collapsed") === "1");

  if (adminApp.projectId !== "internal") return notFound();

  const handleShuffle = () => {
    const data = generateShuffledData();
    const configJson = JSON.stringify(data.config, null, 2);
    const dbJson = JSON.stringify(data.db, null, 2);
    const nextStartDate = new Date(data.startMillis).toISOString().slice(0, 16);
    const nextEndDate = new Date(data.endMillis).toISOString().slice(0, 16);
    setMockConfigJson(configJson);
    writeLocalStorage("mockConfigJson", configJson);
    setMockDbJson(dbJson);
    writeLocalStorage("mockDbJson", dbJson);
    setCustomerId(data.customerId);
    writeLocalStorage("customerId", data.customerId);
    setStartDate(nextStartDate);
    writeLocalStorage("startDate", nextStartDate);
    setEndDate(nextEndDate);
    writeLocalStorage("endDate", nextEndDate);
  };

  const handleLoad = async () => {
    setError(null); setResult(null);
    const body: any = { mode, customer_type: customerType, customer_id: customerId, start_millis: new Date(startDate).getTime(), end_millis: new Date(endDate).getTime() };
    if (mode === "live") { body.tenancy_id = tenancyId; }
    else { try { body.mock_tenancy_config = JSON.parse(mockConfigJson); body.mock_db = JSON.parse(mockDbJson); } catch { setError("Invalid JSON"); return; } }
    const response = await adminApp[stackAppInternalsSymbol].sendRequest("/internal/payments/ledger-playground", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "admin");
    const data = await response.json();
    if (!response.ok) { setError(data?.error ?? data?.message ?? `Error ${response.status}`); return; }
    setResult(data);
  };

  return (
    <PageLayout title="Ledger Playground" description="Visualize payments ledger state over time.">
      <div className="space-y-3 max-w-full">
        {result && (
          <div>
            <Typography className="text-xs font-medium text-muted-foreground mb-1">{result.transactions.length} transactions, {result.snapshots.length} snapshots</Typography>
            <TimelineView result={result} configProducts={(() => {
              try {
                return JSON.parse(mockConfigJson)?.products ?? {};
              } catch {
                return {};
              }
            })()} />
          </div>
        )}
        {error && <div className="rounded bg-destructive/10 border border-destructive/20 p-2"><Typography className="text-xs text-destructive">{error}</Typography></div>}

        <div className="border rounded p-3 bg-muted/5 space-y-2">
          <div className="flex items-center justify-between">
            <Typography className="text-xs font-medium">Data Source</Typography>
            <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              writeLocalStorage("collapsed", next ? "1" : "0");
            }}>{collapsed ? "expand" : "collapse"}</button>
          </div>
          {!collapsed && (<>
            <div className="flex gap-2 items-center flex-wrap">
              <select value={mode} onChange={(e) => {
                const next = e.target.value as "mock" | "live";
                setMode(next);
                writeLocalStorage("mode", next);
              }} className="h-8 rounded border border-input bg-transparent px-2 text-xs"><option value="mock">Mock</option><option value="live">Live</option></select>
              <select value={customerType} onChange={(e) => {
                const next = e.target.value as "custom" | "user" | "team";
                setCustomerType(next);
                writeLocalStorage("customerType", next);
              }} className="h-8 rounded border border-input bg-transparent px-2 text-xs"><option value="custom">custom</option><option value="user">user</option><option value="team">team</option></select>
              <input value={customerId} onChange={(e) => {
                const next = e.target.value;
                setCustomerId(next);
                writeLocalStorage("customerId", next);
              }} placeholder="Customer ID" className="h-8 w-40 rounded border border-input bg-transparent px-2 text-xs" />
              {mode === "live" && <input value={tenancyId} onChange={(e) => {
                const next = e.target.value;
                setTenancyId(next);
                writeLocalStorage("tenancyId", next);
              }} placeholder="Tenancy ID" className="h-8 w-56 rounded border border-input bg-transparent px-2 text-xs" />}
              <input type="datetime-local" value={startDate} onChange={(e) => {
                const next = e.target.value;
                setStartDate(next);
                writeLocalStorage("startDate", next);
              }} className="h-8 rounded border border-input bg-transparent px-1.5 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="datetime-local" value={endDate} onChange={(e) => {
                const next = e.target.value;
                setEndDate(next);
                writeLocalStorage("endDate", next);
              }} className="h-8 rounded border border-input bg-transparent px-1.5 text-xs" />
              {mode === "mock" && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleShuffle}>Shuffle</Button>}
              <Button size="sm" className="h-8 text-xs" onClick={handleLoad}>Load</Button>
            </div>
            {mode === "mock" && (
              <div className="space-y-2">
                <details>
                  <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground select-none">JSON Editors</summary>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <div><Typography className="text-[10px] text-muted-foreground mb-0.5">Config</Typography>
                      <textarea value={mockConfigJson} onChange={(e) => {
                        const next = e.target.value;
                        setMockConfigJson(next);
                        writeLocalStorage("mockConfigJson", next);
                      }} className="w-full h-32 rounded border border-input bg-transparent px-2 py-1 text-[10px] font-mono resize-y" spellCheck={false} /></div>
                    <div><Typography className="text-[10px] text-muted-foreground mb-0.5">DB</Typography>
                      <textarea value={mockDbJson} onChange={(e) => {
                        const next = e.target.value;
                        setMockDbJson(next);
                        writeLocalStorage("mockDbJson", next);
                      }} className="w-full h-32 rounded border border-input bg-transparent px-2 py-1 text-[10px] font-mono resize-y" spellCheck={false} /></div>
                  </div>
                </details>
                <MockDbTableEditor dbJson={mockDbJson} onChange={(next) => {
                  setMockDbJson(next);
                  writeLocalStorage("mockDbJson", next);
                }} customerId={customerId} />
              </div>
            )}
          </>)}
        </div>
      </div>
    </PageLayout>
  );
}
