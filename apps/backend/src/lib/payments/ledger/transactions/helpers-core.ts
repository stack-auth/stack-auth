import type { CustomerType } from "@/generated/prisma/client";
import type { Transaction, TransactionEntry } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToLowercase } from "@stackframe/stack-shared/dist/utils/strings";
import type { GrantSlice, RepeatInterval } from "./types";

export function toCustomerType(value: CustomerType): "user" | "team" | "custom" {
  return typedToLowercase(value);
}

export function addInterval(baseMillis: number, interval: RepeatInterval): number {
  const [value, unit] = interval;
  const date = new Date(baseMillis);
  if (unit === "minute") date.setMinutes(date.getMinutes() + value);
  else if (unit === "hour") date.setHours(date.getHours() + value);
  else if (unit === "day") date.setDate(date.getDate() + value);
  else if (unit === "week") date.setDate(date.getDate() + value * 7);
  else if (unit === "month") date.setMonth(date.getMonth() + value);
  else date.setFullYear(date.getFullYear() + value);
  return date.getTime();
}

export function normalizeRepeat(input: unknown): RepeatInterval | null {
  if (!Array.isArray(input) || input.length !== 2) return null;
  const [rawValue, rawUnit] = input;
  if (!Number.isFinite(rawValue) || Math.trunc(rawValue as number) !== rawValue || (rawValue as number) <= 0) return null;
  if (!["minute", "hour", "day", "week", "month", "year"].includes(String(rawUnit))) return null;
  return [rawValue as number, rawUnit as RepeatInterval[1]];
}

export function negateChargedAmount(chargedAmount: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(chargedAmount).map(([currency, amount]) => [
    currency,
    amount.startsWith("-") ? amount.slice(1) : `-${amount}`,
  ]));
}

export function createMoneyTransferEntry(options: {
  customerType: "user" | "team" | "custom",
  customerId: string,
  chargedAmount: Record<string, string | undefined>,
  skip: boolean,
}): TransactionEntry | null {
  if (options.skip) return null;
  const chargedCurrencies = Object.keys(options.chargedAmount);
  if (chargedCurrencies.length === 0) return null;
  return {
    type: "money-transfer",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: options.customerType,
    customer_id: options.customerId,
    charged_amount: options.chargedAmount,
    net_amount: { USD: options.chargedAmount.USD ?? "0" },
  };
}

export function parseIncludedItems(product: any): Array<{
  itemId: string,
  quantity: number,
  expires: string,
  repeat: RepeatInterval | null,
}> {
  const out: Array<{ itemId: string, quantity: number, expires: string, repeat: RepeatInterval | null }> = [];
  for (const [itemId, config] of Object.entries(product?.included_items ?? {})) {
    const quantity = Number((config as any)?.quantity ?? 0);
    if (quantity <= 0) continue;
    out.push({
      itemId,
      quantity,
      expires: String((config as any)?.expires ?? "never"),
      repeat: normalizeRepeat((config as any)?.repeat ?? null),
    });
  }
  return out;
}

export function txBase(type: Transaction["type"], id: string, millis: number, entries: TransactionEntry[], testMode: boolean, details?: Record<string, unknown>): Transaction {
  return {
    id,
    type,
    created_at_millis: millis,
    effective_at_millis: millis,
    entries,
    adjusted_by: [],
    test_mode: testMode,
    ...(details ? { details } : {}),
  };
}

export function consumeFromGrants(grants: GrantSlice[], quantity: number): GrantSlice[] {
  let remaining = quantity;
  const consumed: GrantSlice[] = [];
  for (let i = 0; i < grants.length && remaining > 0; i++) {
    const grant = grants[i];
    const used = Math.min(grant.quantity, remaining);
    if (used > 0) {
      consumed.push({ txId: grant.txId, entryIndex: grant.entryIndex, quantity: used });
      grant.quantity -= used;
      remaining -= used;
    }
  }
  if (remaining > 0) throwErr(`Tried to expire ${quantity} units but only ${quantity - remaining} are active`);
  for (let i = grants.length - 1; i >= 0; i--) {
    if (grants[i].quantity <= 0) grants.splice(i, 1);
  }
  return consumed;
}

export function consumeSpecificGrant(grants: GrantSlice[], adjustedTxId: string, adjustedEntryIndex: number, quantity: number) {
  const grant = grants.find((g) => g.txId === adjustedTxId && g.entryIndex === adjustedEntryIndex)
    ?? throwErr(`Missing active grant slice ${adjustedTxId}:${adjustedEntryIndex}`);
  if (grant.quantity < quantity) throwErr(`Cannot expire ${quantity} from grant ${adjustedTxId}:${adjustedEntryIndex} with only ${grant.quantity}`);
  grant.quantity -= quantity;
  for (let i = grants.length - 1; i >= 0; i--) {
    if (grants[i].quantity <= 0) grants.splice(i, 1);
  }
}

export function getLatestGrant(grants: GrantSlice[]): GrantSlice | null {
  return grants.length > 0 ? grants[grants.length - 1] : null;
}

export function itemChangeEntry(customerType: "user" | "team" | "custom", customerId: string, itemId: string, quantity: number): TransactionEntry {
  return {
    type: "item-quantity-change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: customerType,
    customer_id: customerId,
    item_id: itemId,
    quantity,
  };
}

export function itemExpireEntry(customerType: "user" | "team" | "custom", customerId: string, itemId: string, quantity: number, adjustedTxId: string, adjustedEntryIndex: number): TransactionEntry {
  return {
    type: "item-quantity-expire",
    adjusted_transaction_id: adjustedTxId,
    adjusted_entry_index: adjustedEntryIndex,
    customer_type: customerType,
    customer_id: customerId,
    item_id: itemId,
    quantity,
  };
}
