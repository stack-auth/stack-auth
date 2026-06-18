import { moneyAmountToStripeUnits } from "@hexclave/shared/dist/utils/currencies";
import { SUPPORTED_CURRENCIES, type MoneyAmount } from "@hexclave/shared/dist/utils/currency-constants";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { executeRaw, queryRaw } from "../db";
import { REFUND_TXN_PREFIX } from "./refund-txn-id";
import { createPaymentsSchema } from "./schema/index";
import type {
  CustomerType,
  ItemQuantityRow,
  OwnedProductsRow,
  SubscriptionMapRow,
} from "./schema/types";
import {
  createBulldozerExecutionContext,
  toExecutableSqlTransaction,
  toQueryableSqlQuery,
  type BulldozerExecutionContext,
} from "../lib/bulldozer/db";
import { quoteSqlStringLiteral, tableIdToDebugString } from "../lib/bulldozer/db/utilities";
import type { SqlQuery, SqlStatement } from "../lib/bulldozer/db/utilities";

const schema = createPaymentsSchema();
const USD_CURRENCY = SUPPORTED_CURRENCIES.find((currency) => currency.code === "USD")
  ?? throwErr("USD currency configuration missing in SUPPORTED_CURRENCIES");

type StoredTable = {
  setRow(
    ctx: BulldozerExecutionContext,
    id: string,
    data: { type: "expression", sql: string },
  ): SqlStatement[],
};

function customerGroupKeySql(tenancyId: string, customerType: CustomerType, customerId: string) {
  const json = JSON.stringify({ tenancyId, customerType, customerId });
  return `${quoteSqlStringLiteral(json).sql}::jsonb`;
}

async function getLatestRow<T>(
  table: { listRowsInGroup: (ctx: BulldozerExecutionContext, opts: { groupKey?: { type: "expression", sql: string }, start: "start", end: "end", startInclusive: boolean, endInclusive: boolean }) => SqlQuery },
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
): Promise<T | null> {
  const executionContext = createBulldozerExecutionContext();
  const innerSql = toQueryableSqlQuery(table.listRowsInGroup(executionContext, {
    groupKey: { type: "expression", sql: customerGroupKeySql(tenancyId, customerType, customerId) },
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));

  const sql = `
    SELECT * FROM (${innerSql}) AS "__all_rows"
    ORDER BY "__all_rows"."rowsortkey" DESC NULLS LAST, "__all_rows"."rowidentifier" DESC
    LIMIT 1
  `;
  const rows = await queryRaw<Array<{ rowdata: unknown }>>(sql);
  if (rows.length === 0) return null;
  return rows[0].rowdata as T;
}

export async function getOwnedProductsForCustomer(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<OwnedProductsRow["ownedProducts"]> {
  const row = await getLatestRow<OwnedProductsRow>(
    schema.ownedProducts,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.ownedProducts ?? {};
}

export async function getItemQuantitiesForCustomer(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<Record<string, number>> {
  const row = await getLatestRow<ItemQuantityRow>(
    schema.itemQuantities,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.itemQuantities ?? {};
}

export async function getSubscriptionMapForCustomer(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
}): Promise<SubscriptionMapRow["subscriptions"]> {
  const row = await getLatestRow<SubscriptionMapRow>(
    schema.subscriptionMapByCustomer,
    options.tenancyId,
    options.customerType,
    options.customerId,
  );
  return row?.subscriptions ?? {};
}

function getJsonObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body == null || Array.isArray(body)) {
    throw new Error("Expected JSON object body");
  }
  return Object.fromEntries(Object.entries(body));
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string field: ${fieldName}`);
  }
  return value;
}

function readRowData(body: unknown): Record<string, unknown> {
  const record = getJsonObjectBody(body);
  const rowData = record.rowData;
  if (typeof rowData !== "object" || rowData == null || Array.isArray(rowData)) {
    throw new Error("Expected rowData object");
  }
  return Object.fromEntries(Object.entries(rowData));
}

async function setStoredRow(options: {
  tenancyId: string,
  storedTable: StoredTable,
  rowId: string,
  rowData: Record<string, unknown>,
}): Promise<void> {
  const rowTenancyId = readString(options.rowData.tenancyId, "rowData.tenancyId");
  if (rowTenancyId !== options.tenancyId) {
    throw new Error(`Row tenancyId ${rowTenancyId} does not match URL tenancyId ${options.tenancyId}`);
  }

  const executionContext = createBulldozerExecutionContext();
  const serializedRowData = JSON.stringify(options.rowData);
  const sql = toExecutableSqlTransaction(
    executionContext,
    options.storedTable.setRow(executionContext, options.rowId, {
      type: "expression",
      sql: `${quoteSqlStringLiteral(serializedRowData).sql}::jsonb`,
    }),
  );
  await executeRaw(sql);
}

export async function setSubscriptionRow(options: {
  tenancyId: string,
  body: unknown,
}): Promise<void> {
  const rowData = readRowData(options.body);
  await setStoredRow({
    tenancyId: options.tenancyId,
    storedTable: schema.subscriptions,
    rowId: readString(rowData.id, "rowData.id"),
    rowData,
  });
}

export async function setSubscriptionInvoiceRow(options: {
  tenancyId: string,
  body: unknown,
}): Promise<void> {
  const rowData = readRowData(options.body);
  await setStoredRow({
    tenancyId: options.tenancyId,
    storedTable: schema.subscriptionInvoices,
    rowId: readString(rowData.id, "rowData.id"),
    rowData,
  });
}

export async function setOneTimePurchaseRow(options: {
  tenancyId: string,
  body: unknown,
}): Promise<void> {
  const rowData = readRowData(options.body);
  await setStoredRow({
    tenancyId: options.tenancyId,
    storedTable: schema.oneTimePurchases,
    rowId: readString(rowData.id, "rowData.id"),
    rowData,
  });
}

export async function setManualItemQuantityChangeRow(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
  body: unknown,
}): Promise<void> {
  const rowData = readRowData(options.body);
  if (rowData.customerType !== options.customerType || rowData.customerId !== options.customerId) {
    throw new Error("Manual item quantity change row does not match URL customer");
  }
  await setStoredRow({
    tenancyId: options.tenancyId,
    storedTable: schema.manualItemQuantityChanges,
    rowId: readString(rowData.id, "rowData.id"),
    rowData,
  });
}

export async function setManualTransactionRow(options: {
  tenancyId: string,
  transactionId: string,
  body: unknown,
}): Promise<void> {
  const rowData = readRowData(options.body);
  await setStoredRow({
    tenancyId: options.tenancyId,
    storedTable: schema.manualTransactions,
    rowId: options.transactionId,
    rowData,
  });
}

export async function readPriorRefundSummary(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
  sourceTxnId: string,
}): Promise<{ refundedStripeUnits: number, productRevoked: boolean }> {
  const executionContext = createBulldozerExecutionContext();
  const baseSql = toQueryableSqlQuery(schema.transactions.listRowsInGroup(executionContext, {
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
  const sql = `
    SELECT "__rows"."rowdata" AS "rowData"
    FROM (${baseSql}) AS "__rows"
    WHERE "__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}
      AND "__rows"."rowdata"->>'type' = 'refund'
      AND "__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}
      AND "__rows"."rowdata"->>'customerId' = ${quoteSqlStringLiteral(options.customerId).sql}
      AND ("__rows"."rowdata"->>'txnId') LIKE ${quoteSqlStringLiteral(`${REFUND_TXN_PREFIX}${options.sourceTxnId}:%`).sql}
  `;
  const rows = await queryRaw<Array<{ rowData: unknown }>>(sql);
  let refundedStripeUnits = 0;
  let productRevoked = false;
  for (const row of rows) {
    const rowData = row.rowData;
    if (typeof rowData !== "object" || rowData === null) continue;
    const entries = Reflect.get(rowData, "entries");
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue;
      const type = Reflect.get(entry, "type");
      if (type === "product-revocation") {
        const adjustedTxnId = Reflect.get(entry, "adjustedTransactionId");
        if (adjustedTxnId === options.sourceTxnId) {
          productRevoked = true;
        }
      } else if (type === "money-transfer") {
        const chargedAmount = Reflect.get(entry, "chargedAmount");
        if (typeof chargedAmount !== "object" || chargedAmount === null) continue;
        const usd = Reflect.get(chargedAmount, "USD");
        if (typeof usd !== "string") continue;
        const absolute = usd.startsWith("-") ? usd.slice(1) : usd;
        refundedStripeUnits += moneyAmountToStripeUnits(absolute as MoneyAmount, USD_CURRENCY);
      }
    }
  }
  return { refundedStripeUnits, productRevoked };
}

export function computeOutstandingItemGrants(
  rows: Array<{ txnId: unknown, entries: unknown }>,
): Array<{ txnId: string, entryIndex: number, itemId: string, quantity: number }> {
  const grants: Array<{ txnId: string, entryIndex: number, itemId: string, quantity: number }> = [];
  const expiredKeys = new Set<string>();
  const grantKey = (txnId: string, entryIndex: number) => `${txnId}:${entryIndex}`;

  for (const row of rows) {
    const txnId = row.txnId;
    if (typeof txnId !== "string") continue;
    const entries = row.entries;
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (typeof entry !== "object" || entry === null) continue;
      const type = Reflect.get(entry, "type");
      if (type === "item-quantity-change") {
        const expiresWhen = Reflect.get(entry, "expiresWhen");
        if (expiresWhen !== "when-purchase-expires" && expiresWhen !== "when-repeated") {
          continue;
        }
        const itemId = Reflect.get(entry, "itemId");
        const quantity = Reflect.get(entry, "quantity");
        if (typeof itemId !== "string" || typeof quantity !== "number") continue;
        grants.push({ txnId, entryIndex: index, itemId, quantity });
      } else if (type === "item-quantity-expire") {
        const adjustedTxnId = Reflect.get(entry, "adjustedTransactionId");
        const adjustedIdx = Reflect.get(entry, "adjustedEntryIndex");
        if (typeof adjustedTxnId !== "string" || typeof adjustedIdx !== "number") continue;
        expiredKeys.add(grantKey(adjustedTxnId, adjustedIdx));
      }
    }
  }

  return grants.filter((g) => !expiredKeys.has(grantKey(g.txnId, g.entryIndex)));
}

export async function readOutstandingItemGrants(options: {
  tenancyId: string,
  customerType: CustomerType,
  customerId: string,
  sourceTxnId: string,
  igrSourceId: string,
}): Promise<Array<{ txnId: string, entryIndex: number, itemId: string, quantity: number }>> {
  const executionContext = createBulldozerExecutionContext();
  const baseSql = toQueryableSqlQuery(schema.transactions.listRowsInGroup(executionContext, {
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));
  const igrPrefix = `igr:${options.igrSourceId}:`;
  const sql = `
    SELECT "__rows"."rowdata" AS "rowData"
    FROM (${baseSql}) AS "__rows"
    WHERE "__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}
      AND "__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}
      AND "__rows"."rowdata"->>'customerId' = ${quoteSqlStringLiteral(options.customerId).sql}
      AND (
        ("__rows"."rowdata"->>'txnId') = ${quoteSqlStringLiteral(options.sourceTxnId).sql}
        OR (
          ("__rows"."rowdata"->>'type') = 'item-grant-repeat'
          AND ("__rows"."rowdata"->>'txnId') LIKE ${quoteSqlStringLiteral(`${igrPrefix}%`).sql}
        )
      )
  `;
  const rows = await queryRaw<Array<{ rowData: unknown }>>(sql);
  return computeOutstandingItemGrants(rows.map((row) => {
    const rowData = row.rowData;
    if (typeof rowData !== "object" || rowData === null) {
      return { txnId: null, entries: null };
    }
    return {
      txnId: Reflect.get(rowData, "txnId"),
      entries: Reflect.get(rowData, "entries"),
    };
  }));
}

export async function verifyPaymentsDataIntegrity(): Promise<void> {
  const executionContext = createBulldozerExecutionContext();
  for (const table of schema._allTables) {
    const errors = await queryRaw<unknown[]>(toQueryableSqlQuery(table.verifyDataIntegrity(executionContext)));
    if (errors.length > 0) {
      throw new Error(`Bulldozer data integrity violation in table ${tableIdToDebugString(table.tableId)}: found ${errors.length} error row(s).`);
    }
  }
}
