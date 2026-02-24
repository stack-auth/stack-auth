import { productToInlineProduct } from "@/lib/payments/index";
import type { TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { buildChargedAmount, resolveSelectedPriceFromProduct } from "../transaction-helpers";
import {
  addInterval,
  consumeFromGrants,
  consumeSpecificGrant,
  createMoneyTransferEntry,
  getLatestGrant,
  itemChangeEntry,
  itemExpireEntry,
  negateChargedAmount,
  parseIncludedItems,
  toCustomerType,
  txBase,
} from "./helpers-core";
import type { BuildState } from "./state";
import type { ActivePurchaseState, RepeatInterval, SeedEvent } from "./types";

function queueRepeatEventsForPurchase(
  state: BuildState,
  sourceKey: string,
  causedByTxId: string,
  anchorMillis: number,
  itemStates: ActivePurchaseState["itemStates"],
) {
  const groups = new Map<string, Array<{
    itemId: string,
    quantity: number,
    expiresWhenRepeated: boolean,
    adjustedTxId: string,
    adjustedEntryIndex: number,
  }>>();

  for (const [itemId, itemState] of itemStates) {
    if (!itemState.repeat) continue;
    const latestGrant = getLatestGrant(itemState.grants);
    if (!latestGrant) continue;
    const key = JSON.stringify(itemState.repeat);
    const group = groups.get(key) ?? [];
    group.push({
      itemId,
      quantity: latestGrant.quantity,
      expiresWhenRepeated: itemState.expires === "when-repeated",
      adjustedTxId: latestGrant.txId,
      adjustedEntryIndex: latestGrant.entryIndex,
    });
    groups.set(key, group);
  }

  for (const [repeatKey, items] of groups) {
    const repeat = JSON.parse(repeatKey) as RepeatInterval;
    state.queue.push({
      kind: "item-grant-repeat-event",
      at: addInterval(anchorMillis, repeat),
      repeat,
      sourceKey,
      causedByTxId,
      items,
    });
  }
}

function queueRepeatEventsForDefaults(state: BuildState, causedByTxId: string, anchorMillis: number) {
  const groups = new Map<string, Array<{
    productId: string,
    itemId: string,
    quantity: number,
    expiresWhenRepeated: boolean,
    adjustedTxId: string,
    adjustedEntryIndex: number,
  }>>();

  for (const [productId, productItems] of state.activeDefaultProducts) {
    for (const [itemId, itemState] of productItems) {
      if (!itemState.repeat) continue;
      if (itemState.sourceTxId !== causedByTxId) continue;
      const latestGrant = getLatestGrant(itemState.grants);
      if (!latestGrant) continue;
      const key = JSON.stringify(itemState.repeat);
      const group = groups.get(key) ?? [];
      group.push({
        productId,
        itemId,
        quantity: itemState.quantity,
        expiresWhenRepeated: itemState.expiresWhenRepeated,
        adjustedTxId: latestGrant.txId,
        adjustedEntryIndex: latestGrant.entryIndex,
      });
      groups.set(key, group);
    }
  }

  for (const [repeatKey, items] of groups) {
    const repeat = JSON.parse(repeatKey) as RepeatInterval;
    state.queue.push({
      kind: "default-product-item-grant-repeat-event",
      at: addInterval(anchorMillis, repeat),
      repeat,
      causedByTxId,
      items,
    });
  }
}

export function processEvent(state: BuildState, event: SeedEvent) {
  if (event.kind === "default-products-change-event") {
    const snapshot = event.snapshotRow.snapshot as Record<string, any>;
    const txId = `default-products:${event.snapshotRow.id}`;
    const entries: TransactionEntry[] = [{
      type: "default-products-change",
      snapshot,
      adjusted_transaction_id: state.previousDefaultProductsChangePointer?.txId ?? null,
      adjusted_entry_index: state.previousDefaultProductsChangePointer?.entryIndex ?? null,
    } as TransactionEntry];

    const nextState = new Map<string, Map<string, (typeof state.activeDefaultProducts extends Map<any, Map<any, infer T>> ? T : never)>>();
    const allProductIds = new Set<string>([
      ...state.activeDefaultProducts.keys(),
      ...Object.keys(snapshot),
    ]);

    for (const productId of allProductIds) {
      const previousItems = state.activeDefaultProducts.get(productId) ?? new Map();
      const nextItemsConfig = new Map(parseIncludedItems(snapshot[productId]).map((item) => [item.itemId, item]));
      const allItemIds = new Set<string>([
        ...previousItems.keys(),
        ...nextItemsConfig.keys(),
      ]);
      const nextItems = new Map<string, any>();

      for (const itemId of allItemIds) {
        const prev = previousItems.get(itemId);
        const nextConfig = nextItemsConfig.get(itemId);
        const prevQuantity = prev?.quantity ?? 0;
        const nextQuantity = nextConfig?.quantity ?? 0;
        const currentGrants = prev ? prev.grants.map((g: any) => ({ ...g })) : [];

        if (nextQuantity < prevQuantity) {
          const consumed = consumeFromGrants(currentGrants, prevQuantity - nextQuantity);
          for (const slice of consumed) {
            entries.push({
              type: "default-product-item-expire",
              adjusted_transaction_id: slice.txId,
              adjusted_entry_index: slice.entryIndex,
              product_id: productId,
              item_id: itemId,
              quantity: slice.quantity,
            } as TransactionEntry);
          }
        }

        if (nextQuantity > prevQuantity) {
          const delta = nextQuantity - prevQuantity;
          const entryIndex = entries.length;
          entries.push({
            type: "default-product-item-grant",
            adjusted_transaction_id: null,
            adjusted_entry_index: null,
            product_id: productId,
            item_id: itemId,
            quantity: delta,
            expires_when_repeated: nextConfig?.expires === "when-repeated",
          } as TransactionEntry);
          currentGrants.push({ txId, entryIndex, quantity: delta });
        }

        if (nextQuantity > 0 && nextConfig) {
          nextItems.set(itemId, {
            quantity: nextQuantity,
            repeat: nextConfig.repeat,
            expiresWhenRepeated: nextConfig.expires === "when-repeated",
            sourceTxId: txId,
            grants: currentGrants,
          });
        }
      }

      if (nextItems.size > 0) nextState.set(productId, nextItems);
    }

    state.output.push(txBase("default-products-change", txId, event.at, entries, false));
    state.previousDefaultProductsChangePointer = { txId, entryIndex: 0 };
    state.activeDefaultProducts = nextState as any;
    queueRepeatEventsForDefaults(state, txId, event.at);
    return;
  }

  if (event.kind === "default-product-item-grant-repeat-event") {
    const txId = `${event.causedByTxId}:repeat:${event.at}:${JSON.stringify(event.repeat)}`;
    const entries: TransactionEntry[] = [];
    const nextItems: typeof event.items = [];

    for (const payload of event.items) {
      const itemState = state.activeDefaultProducts.get(payload.productId)?.get(payload.itemId);
      if (!itemState) continue;
      if (itemState.sourceTxId !== event.causedByTxId) continue;
      if (JSON.stringify(itemState.repeat) !== JSON.stringify(event.repeat)) continue;

      if (payload.expiresWhenRepeated) {
        entries.push({
          type: "default-product-item-expire",
          adjusted_transaction_id: payload.adjustedTxId,
          adjusted_entry_index: payload.adjustedEntryIndex,
          product_id: payload.productId,
          item_id: payload.itemId,
          quantity: payload.quantity,
        } as TransactionEntry);
        consumeSpecificGrant(itemState.grants, payload.adjustedTxId, payload.adjustedEntryIndex, payload.quantity);
      }

      const entryIndex = entries.length;
      entries.push({
        type: "default-product-item-change",
        adjusted_transaction_id: null,
        adjusted_entry_index: null,
        product_id: payload.productId,
        item_id: payload.itemId,
        quantity: payload.quantity,
        expires_when_repeated: payload.expiresWhenRepeated,
      } as TransactionEntry);
      itemState.grants.push({ txId, entryIndex, quantity: payload.quantity });
      nextItems.push({
        ...payload,
        adjustedTxId: txId,
        adjustedEntryIndex: entryIndex,
      });
    }

    if (entries.length === 0) return;
    state.output.push(txBase("default-product-item-grant-repeat", txId, event.at, entries, false, {
      source_transaction_id: event.causedByTxId,
    }));
    state.queue.push({
      ...event,
      at: addInterval(event.at, event.repeat),
      items: nextItems,
    });
    return;
  }

  if (event.kind === "subscription-start-event") {
    const sub = event.subscription;
    const customerType = toCustomerType(sub.customerType);
    const inlineProduct = productToInlineProduct(sub.product as any);
    const testMode = sub.creationSource === "TEST_MODE";
    const selectedPrice = resolveSelectedPriceFromProduct(sub.product as any, sub.priceId ?? null);
    const chargedAmount = buildChargedAmount(selectedPrice, sub.quantity);
    const entries: TransactionEntry[] = [{
      type: "active-subscription-start",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: sub.customerId,
      subscription_id: sub.id,
      product_id: sub.productId ?? null,
      product: inlineProduct,
    } as TransactionEntry];

    const transfer = createMoneyTransferEntry({
      customerType,
      customerId: sub.customerId,
      chargedAmount,
      skip: testMode,
    });
    if (transfer) entries.push(transfer);

    const productGrantIndex = entries.length;
    entries.push({
      type: "product-grant",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: sub.customerId,
      product_id: sub.productId ?? null,
      product: inlineProduct,
      price_id: sub.priceId ?? null,
      quantity: sub.quantity,
      cycle_anchor: (sub.billingCycleAnchor ?? sub.createdAt).getTime(),
      subscription_id: sub.id,
    } as TransactionEntry);

    const itemStates = new Map<string, any>();
    const itemQuantityChangeIndices: Record<string, number> = {};
    for (const item of parseIncludedItems(inlineProduct)) {
      const quantity = item.quantity * sub.quantity;
      const entryIndex = entries.length;
      entries.push(itemChangeEntry(customerType, sub.customerId, item.itemId, quantity));
      itemQuantityChangeIndices[item.itemId] = entryIndex;
      itemStates.set(item.itemId, {
        expires: item.expires,
        repeat: item.repeat,
        grants: [{ txId: sub.id, entryIndex, quantity }],
      });
    }
    (entries[productGrantIndex] as any).item_quantity_change_indices = itemQuantityChangeIndices;

    state.output.push(txBase("subscription-start", sub.id, event.at, entries, testMode));
    const sourceKey = `subscription:${sub.id}`;
    state.activePurchases.set(sourceKey, {
      sourceKind: "subscription",
      sourceId: sub.id,
      customerType,
      customerId: sub.customerId,
      testMode,
      quantity: sub.quantity,
      product: inlineProduct,
      productGrantPointer: { txId: sub.id, entryIndex: productGrantIndex },
      itemStates,
    });
    queueRepeatEventsForPurchase(state, sourceKey, sub.id, (sub.billingCycleAnchor ?? sub.createdAt).getTime(), itemStates);
    return;
  }

  if (event.kind === "subscription-renewal-event") {
    const source = state.activePurchases.get(`subscription:${event.invoice.subscription.id}`);
    if (!source) return;
    const selectedPrice = resolveSelectedPriceFromProduct(event.invoice.subscription.product as any, event.invoice.subscription.priceId ?? null);
    const chargedAmount = buildChargedAmount(selectedPrice, event.invoice.subscription.quantity);
    const transfer = createMoneyTransferEntry({
      customerType: source.customerType,
      customerId: source.customerId,
      chargedAmount,
      skip: false,
    });
    state.output.push(txBase("subscription-renewal", event.invoice.id, event.at, transfer ? [transfer] : [], false));
    return;
  }

  if (event.kind === "one-time-purchase-event") {
    const purchase = event.purchase;
    const customerType = toCustomerType(purchase.customerType);
    const inlineProduct = productToInlineProduct(purchase.product as any);
    const selectedPrice = resolveSelectedPriceFromProduct(purchase.product as any, purchase.priceId ?? null);
    const chargedAmount = buildChargedAmount(selectedPrice, purchase.quantity);
    const testMode = purchase.creationSource === "TEST_MODE";
    const entries: TransactionEntry[] = [];
    const transfer = createMoneyTransferEntry({ customerType, customerId: purchase.customerId, chargedAmount, skip: testMode });
    if (transfer) entries.push(transfer);

    const productGrantIndex = entries.length;
    entries.push({
      type: "product-grant",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: customerType,
      customer_id: purchase.customerId,
      product_id: purchase.productId ?? null,
      product: inlineProduct,
      price_id: purchase.priceId ?? null,
      quantity: purchase.quantity,
      cycle_anchor: purchase.createdAt.getTime(),
      one_time_purchase_id: purchase.id,
    } as TransactionEntry);

    const itemStates = new Map<string, any>();
    const itemQuantityChangeIndices: Record<string, number> = {};
    for (const item of parseIncludedItems(inlineProduct)) {
      const quantity = item.quantity * purchase.quantity;
      const entryIndex = entries.length;
      entries.push(itemChangeEntry(customerType, purchase.customerId, item.itemId, quantity));
      itemQuantityChangeIndices[item.itemId] = entryIndex;
      itemStates.set(item.itemId, {
        expires: item.expires,
        repeat: item.repeat,
        grants: [{ txId: purchase.id, entryIndex, quantity }],
      });
    }
    (entries[productGrantIndex] as any).item_quantity_change_indices = itemQuantityChangeIndices;

    state.output.push(txBase("one-time-purchase", purchase.id, event.at, entries, testMode));
    const sourceKey = `one-time-purchase:${purchase.id}`;
    state.activePurchases.set(sourceKey, {
      sourceKind: "one-time-purchase",
      sourceId: purchase.id,
      customerType,
      customerId: purchase.customerId,
      testMode,
      quantity: purchase.quantity,
      product: inlineProduct,
      productGrantPointer: { txId: purchase.id, entryIndex: productGrantIndex },
      itemStates,
    });
    queueRepeatEventsForPurchase(state, sourceKey, purchase.id, purchase.createdAt.getTime(), itemStates);
    return;
  }

  if (event.kind === "item-grant-repeat-event") {
    const source = state.activePurchases.get(event.sourceKey);
    if (!source) return;
    const txId = `${event.causedByTxId}:repeat:${event.at}:${JSON.stringify(event.repeat)}`;
    const entries: TransactionEntry[] = [];
    const nextItems: typeof event.items = [];

    for (const payload of event.items) {
      const itemState = source.itemStates.get(payload.itemId);
      if (!itemState) continue;
      if (JSON.stringify(itemState.repeat) !== JSON.stringify(event.repeat)) continue;
      if (payload.expiresWhenRepeated) {
        entries.push(itemExpireEntry(
          source.customerType,
          source.customerId,
          payload.itemId,
          payload.quantity,
          payload.adjustedTxId,
          payload.adjustedEntryIndex,
        ));
        consumeSpecificGrant(itemState.grants, payload.adjustedTxId, payload.adjustedEntryIndex, payload.quantity);
      }
      const entryIndex = entries.length;
      entries.push(itemChangeEntry(source.customerType, source.customerId, payload.itemId, payload.quantity));
      itemState.grants.push({ txId, entryIndex, quantity: payload.quantity });
      nextItems.push({
        ...payload,
        adjustedTxId: txId,
        adjustedEntryIndex: entryIndex,
      });
    }

    if (entries.length === 0) return;
    state.output.push(txBase("item-grant-renewal", txId, event.at, entries, source.testMode, {
      source_transaction_id: event.causedByTxId,
    }));
    state.queue.push({
      ...event,
      at: addInterval(event.at, event.repeat),
      items: nextItems,
    });
    return;
  }

  if (event.kind === "subscription-end-event") {
    const sourceKey = `subscription:${event.subscription.id}`;
    const source = state.activePurchases.get(sourceKey);
    if (!source) return;
    const entries: TransactionEntry[] = [{
      type: "active-subscription-stop",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: source.customerType,
      customer_id: source.customerId,
      subscription_id: source.sourceId,
    } as TransactionEntry, {
      type: "product-revocation",
      adjusted_transaction_id: source.productGrantPointer.txId,
      adjusted_entry_index: source.productGrantPointer.entryIndex,
      customer_type: source.customerType,
      customer_id: source.customerId,
      quantity: source.quantity,
    } as TransactionEntry];

    for (const [itemId, itemState] of source.itemStates) {
      if (itemState.expires !== "when-purchase-expires") continue;
      for (const grant of itemState.grants) {
        entries.push(itemExpireEntry(source.customerType, source.customerId, itemId, grant.quantity, grant.txId, grant.entryIndex));
      }
    }

    state.output.push(txBase("subscription-end", `${source.sourceId}:end`, event.at, entries, source.testMode));
    state.activePurchases.delete(sourceKey);
    return;
  }

  if (event.kind === "subscription-refund-event") {
    const sourceKey = `subscription:${event.subscription.id}`;
    const source = state.activePurchases.get(sourceKey);
    if (!source) return;
    const selectedPrice = resolveSelectedPriceFromProduct(event.subscription.product as any, event.subscription.priceId ?? null);
    const chargedAmount = buildChargedAmount(selectedPrice, event.subscription.quantity);
    const entries: TransactionEntry[] = [];
    const transfer = createMoneyTransferEntry({
      customerType: source.customerType,
      customerId: source.customerId,
      chargedAmount: negateChargedAmount(chargedAmount),
      skip: false,
    });
    if (transfer) entries.push(transfer);
    entries.push({
      type: "product-revocation",
      adjusted_transaction_id: source.productGrantPointer.txId,
      adjusted_entry_index: source.productGrantPointer.entryIndex,
      customer_type: source.customerType,
      customer_id: source.customerId,
      quantity: source.quantity,
    } as TransactionEntry);
    for (const [itemId, itemState] of source.itemStates) {
      if (itemState.expires !== "when-purchase-expires") continue;
      for (const grant of itemState.grants) {
        entries.push(itemExpireEntry(source.customerType, source.customerId, itemId, grant.quantity, grant.txId, grant.entryIndex));
      }
    }
    entries.push({
      type: "active-subscription-stop",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: source.customerType,
      customer_id: source.customerId,
      subscription_id: source.sourceId,
    } as TransactionEntry);

    state.output.push(txBase("purchase-refund", `${source.sourceId}:refund`, event.at, entries, source.testMode));
    state.activePurchases.delete(sourceKey);
    return;
  }

  if (event.kind === "one-time-purchase-refund-event") {
    const sourceKey = `one-time-purchase:${event.purchase.id}`;
    const source = state.activePurchases.get(sourceKey);
    if (!source) return;
    const selectedPrice = resolveSelectedPriceFromProduct(event.purchase.product as any, event.purchase.priceId ?? null);
    const chargedAmount = buildChargedAmount(selectedPrice, event.purchase.quantity);
    const entries: TransactionEntry[] = [];
    const transfer = createMoneyTransferEntry({
      customerType: source.customerType,
      customerId: source.customerId,
      chargedAmount: negateChargedAmount(chargedAmount),
      skip: false,
    });
    if (transfer) entries.push(transfer);
    entries.push({
      type: "product-revocation",
      adjusted_transaction_id: source.productGrantPointer.txId,
      adjusted_entry_index: source.productGrantPointer.entryIndex,
      customer_type: source.customerType,
      customer_id: source.customerId,
      quantity: source.quantity,
    } as TransactionEntry);
    for (const [itemId, itemState] of source.itemStates) {
      if (itemState.expires !== "when-purchase-expires") continue;
      for (const grant of itemState.grants) {
        entries.push(itemExpireEntry(source.customerType, source.customerId, itemId, grant.quantity, grant.txId, grant.entryIndex));
      }
    }
    state.output.push(txBase("purchase-refund", `${source.sourceId}:refund`, event.at, entries, source.testMode));
    state.activePurchases.delete(sourceKey);
    return;
  }

  if (event.kind === "subscription-cancel-event") {
    const source = state.activePurchases.get(`subscription:${event.subscription.id}`);
    if (!source) return;
    state.output.push(txBase("subscription-cancel", `${source.sourceId}:cancel`, event.at, [{
      type: "active-subscription-change",
      adjusted_transaction_id: null,
      adjusted_entry_index: null,
      customer_type: source.customerType,
      customer_id: source.customerId,
      subscription_id: source.sourceId,
      change_type: "cancel",
    } as TransactionEntry], source.testMode));
    return;
  }

  const customerType = toCustomerType(event.change.customerType);
  const expiresAtMillis = event.change.expiresAt ? event.change.expiresAt.getTime() : null;
  const entry = itemChangeEntry(customerType, event.change.customerId, event.change.itemId, event.change.quantity, expiresAtMillis);
  state.output.push(txBase("manual-item-quantity-change", event.change.id, event.at, [entry], false));
}
