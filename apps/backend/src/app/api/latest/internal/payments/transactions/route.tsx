import { Prisma } from "@/generated/prisma/client";
import { toQueryableSqlQuery } from "@/lib/bulldozer/db/index";
import { quoteSqlStringLiteral } from "@/lib/bulldozer/db/utilities";
import { paymentsSchema } from "@/lib/payments/schema/singleton";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { TRANSACTION_TYPES, transactionSchema, type Transaction, type TransactionEntry, type TransactionType } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const schema = paymentsSchema;

type LedgerTransactionType =
  | "subscription-start"
  | "one-time-purchase"
  | "manual-item-quantity-change"
  | "subscription-renewal";

type LedgerCursor = {
  createdAtMillis: number,
  txnId: string,
};

type LedgerTransactionRow = {
  type: LedgerTransactionType,
  txnId: string,
  effectiveAtMillis: number,
  createdAtMillis: number,
  entries: unknown[],
  paymentProvider: "test_mode" | "stripe" | null,
  refundedAtMillis: number | null,
};

type QueriedLedgerTransactionRow = LedgerTransactionRow & {
  sourceId: string,
};

const DEFAULT_LEDGER_TRANSACTION_TYPES: readonly LedgerTransactionType[] = [
  "subscription-start",
  "one-time-purchase",
  "manual-item-quantity-change",
  "subscription-renewal",
];

function parseCursor(cursor: string): LedgerCursor {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null) {
      throw new StatusError(400, "Invalid cursor");
    }
    const createdAtMillis = Reflect.get(parsed, "createdAtMillis");
    const txnId = Reflect.get(parsed, "txnId");
    if (
      typeof createdAtMillis !== "number" ||
      !Number.isInteger(createdAtMillis) ||
      createdAtMillis < 0 ||
      typeof txnId !== "string" ||
      txnId.length === 0
    ) {
      throw new StatusError(400, "Invalid cursor");
    }
    return { createdAtMillis, txnId };
  } catch (error) {
    if (error instanceof StatusError) {
      throw error;
    }
    throw new StatusError(400, "Invalid cursor");
  }
}

function encodeCursor(cursor: LedgerCursor): string {
  const serialized = JSON.stringify(cursor);
  return Buffer.from(serialized, "utf8").toString("base64url");
}

function getLedgerTypesForFilter(type: string | undefined): readonly LedgerTransactionType[] {
  switch (type) {
    case undefined: {
      return DEFAULT_LEDGER_TRANSACTION_TYPES;
    }
    case "purchase": {
      return ["subscription-start", "one-time-purchase"];
    }
    case "manual-item-quantity-change": {
      return ["manual-item-quantity-change"];
    }
    case "subscription-renewal": {
      return ["subscription-renewal"];
    }
    case "subscription-cancellation":
    case "chargeback":
    case "product-change": {
      return [];
    }
    default: {
      throw new StatusError(400, "Invalid transaction type filter");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLedgerTransactionRow(rowData: unknown): LedgerTransactionRow {
  if (!isRecord(rowData)) {
    throw new StackAssertionError("Ledger transaction rowData is not an object", { rowData });
  }
  const txnId = Reflect.get(rowData, "txnId");
  const type = Reflect.get(rowData, "type");
  const effectiveAtMillis = Reflect.get(rowData, "effectiveAtMillis");
  const createdAtMillis = Reflect.get(rowData, "createdAtMillis");
  const entries = Reflect.get(rowData, "entries");
  const paymentProvider = Reflect.get(rowData, "paymentProvider");
  const refundedAtMillisValue = Reflect.get(rowData, "refundedAtMillis");
  const refundedAtMillis = refundedAtMillisValue === undefined ? null : refundedAtMillisValue;

  if (typeof txnId !== "string" || txnId.length === 0) {
    throw new StackAssertionError("Ledger transaction row is missing txnId", { rowData });
  }
  if (
    type !== "subscription-start" &&
    type !== "one-time-purchase" &&
    type !== "manual-item-quantity-change" &&
    type !== "subscription-renewal"
  ) {
    throw new StackAssertionError("Unexpected ledger transaction type", { rowData });
  }
  if (typeof effectiveAtMillis !== "number" || !Number.isInteger(effectiveAtMillis) || effectiveAtMillis < 0) {
    throw new StackAssertionError("Ledger transaction row has invalid effectiveAtMillis", { rowData });
  }
  if (typeof createdAtMillis !== "number" || !Number.isInteger(createdAtMillis) || createdAtMillis < 0) {
    throw new StackAssertionError("Ledger transaction row has invalid createdAtMillis", { rowData });
  }
  if (!Array.isArray(entries)) {
    throw new StackAssertionError("Ledger transaction row has invalid entries", { rowData });
  }
  if (paymentProvider !== null && paymentProvider !== "test_mode" && paymentProvider !== "stripe") {
    throw new StackAssertionError("Ledger transaction row has invalid paymentProvider", { rowData });
  }
  if (refundedAtMillis !== null && (typeof refundedAtMillis !== "number" || !Number.isInteger(refundedAtMillis) || refundedAtMillis < 0)) {
    throw new StackAssertionError("Ledger transaction row has invalid refundedAtMillis", { rowData });
  }

  return {
    type,
    txnId,
    effectiveAtMillis,
    createdAtMillis,
    entries,
    paymentProvider,
    refundedAtMillis,
  };
}

function parseSourceId(row: LedgerTransactionRow): string {
  if (row.type === "subscription-start") {
    if (!row.txnId.startsWith("sub-start:")) {
      throw new StackAssertionError("subscription-start transaction id has invalid prefix", { txnId: row.txnId });
    }
    return row.txnId.slice("sub-start:".length);
  }
  if (row.type === "one-time-purchase") {
    if (!row.txnId.startsWith("otp:")) {
      throw new StackAssertionError("one-time-purchase transaction id has invalid prefix", { txnId: row.txnId });
    }
    return row.txnId.slice("otp:".length);
  }
  if (row.type === "manual-item-quantity-change") {
    if (!row.txnId.startsWith("miqc:")) {
      throw new StackAssertionError("manual-item-quantity-change transaction id has invalid prefix", { txnId: row.txnId });
    }
    return row.txnId.slice("miqc:".length);
  }
  if (!row.txnId.startsWith("sub-renewal:")) {
    throw new StackAssertionError("subscription-renewal transaction id has invalid prefix", { txnId: row.txnId });
  }
  return row.txnId.slice("sub-renewal:".length);
}

function readCustomerType(value: unknown, context: string): "user" | "team" | "custom" {
  if (value === "user" || value === "team" || value === "custom") {
    return value;
  }
  throw new StackAssertionError(`Invalid customerType for ${context}`, { value });
}

function readDayInterval(value: unknown, context: string): [number, "day" | "week" | "month" | "year"] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new StackAssertionError(`Invalid day interval for ${context}`, { value });
  }
  const count = value[0];
  const unit = value[1];
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year")
  ) {
    throw new StackAssertionError(`Invalid day interval for ${context}`, { value });
  }
  return [count, unit];
}

type InlineProduct = Extract<TransactionEntry, { type: "product_grant" }>["product"];

function mapProductSnapshotToInlineProduct(product: unknown): InlineProduct {
  if (!isRecord(product)) {
    throw new StackAssertionError("Invalid product snapshot", { product });
  }

  const customerType = readCustomerType(product.customerType, "product snapshot");
  const includedItemsRaw = product.includedItems;
  if (!isRecord(includedItemsRaw)) {
    throw new StackAssertionError("Invalid includedItems in product snapshot", { product });
  }
  const includedItems: InlineProduct["included_items"] = {};
  for (const [itemId, value] of Object.entries(includedItemsRaw)) {
    if (!isRecord(value)) {
      throw new StackAssertionError("Invalid included item config", { itemId, value });
    }
    const quantity = value.quantity;
    if (typeof quantity !== "number") {
      throw new StackAssertionError("Invalid included item quantity", { itemId, value });
    }
    const repeat = value.repeat;
    const parsedRepeat =
      repeat === undefined || repeat === null
        ? "never"
        : repeat === "never"
          ? "never"
          : readDayInterval(repeat, `included item ${itemId}`);
    const expires = value.expires;
    if (
      expires !== undefined &&
      expires !== null &&
      expires !== "never" &&
      expires !== "when-purchase-expires" &&
      expires !== "when-repeated"
    ) {
      throw new StackAssertionError("Invalid included item expires value", { itemId, value });
    }
    includedItems[itemId] = {
      quantity,
      repeat: parsedRepeat,
      expires: expires === undefined || expires === null ? "never" : expires,
    };
  }

  const prices: InlineProduct["prices"] = {};
  if (product.prices !== "include-by-default") {
    if (!isRecord(product.prices)) {
      throw new StackAssertionError("Invalid prices in product snapshot", { product });
    }
    for (const [priceId, value] of Object.entries(product.prices)) {
      if (!isRecord(value)) {
        throw new StackAssertionError("Invalid price config in product snapshot", { priceId, value });
      }
      const mappedPrice: InlineProduct["prices"][string] = {};
      for (const currency of SUPPORTED_CURRENCIES) {
        const amount = value[currency.code];
        if (typeof amount === "string") {
          mappedPrice[currency.code] = amount;
        }
      }
      if (value.interval !== undefined && value.interval !== null) {
        mappedPrice.interval = readDayInterval(value.interval, `price interval for ${priceId}`);
      }
      if (value.freeTrial !== undefined && value.freeTrial !== null) {
        mappedPrice.free_trial = readDayInterval(value.freeTrial, `price freeTrial for ${priceId}`);
      }
      prices[priceId] = mappedPrice;
    }
  }

  return {
    display_name: typeof product.displayName === "string" ? product.displayName : "Product",
    customer_type: customerType,
    stackable: product.stackable === true,
    server_only: product.serverOnly === true,
    included_items: includedItems,
    client_metadata: product.clientMetadata ?? null,
    client_read_only_metadata: product.clientReadOnlyMetadata ?? null,
    server_metadata: product.serverMetadata ?? null,
    prices,
  };
}

type LedgerProductGrantEntry = {
  type: "product-grant",
  customerType: "user" | "team" | "custom",
  customerId: string,
  productId: string | null,
  product: unknown,
  priceId?: string | null,
  quantity: number,
  subscriptionId?: string | null,
  oneTimePurchaseId?: string | null,
};

type LedgerMoneyTransferEntry = {
  type: "money-transfer",
  customerType: "user" | "team" | "custom",
  customerId: string,
  chargedAmount: Record<string, string>,
};

type LedgerItemQuantityChangeEntry = {
  type: "item-quantity-change",
  customerType: "user" | "team" | "custom",
  customerId: string,
  itemId: string,
  quantity: number,
};

function readProductGrantEntry(entry: Record<string, unknown>): LedgerProductGrantEntry {
  if (typeof entry.customerId !== "string") {
    throw new StackAssertionError("Invalid product-grant customerId", { entry });
  }
  if (entry.productId !== null && typeof entry.productId !== "string") {
    throw new StackAssertionError("Invalid product-grant productId", { entry });
  }
  if (!isRecord(entry.product)) {
    throw new StackAssertionError("Invalid product-grant product snapshot", { entry });
  }
  if (typeof entry.quantity !== "number") {
    throw new StackAssertionError("Invalid product-grant quantity", { entry });
  }
  if (entry.priceId !== undefined && entry.priceId !== null && typeof entry.priceId !== "string") {
    throw new StackAssertionError("Invalid product-grant priceId", { entry });
  }
  if (entry.subscriptionId !== undefined && entry.subscriptionId !== null && typeof entry.subscriptionId !== "string") {
    throw new StackAssertionError("Invalid product-grant subscriptionId", { entry });
  }
  if (entry.oneTimePurchaseId !== undefined && entry.oneTimePurchaseId !== null && typeof entry.oneTimePurchaseId !== "string") {
    throw new StackAssertionError("Invalid product-grant oneTimePurchaseId", { entry });
  }
  return {
    type: "product-grant",
    customerType: readCustomerType(entry.customerType, "product-grant entry"),
    customerId: entry.customerId,
    productId: entry.productId,
    product: entry.product,
    priceId: entry.priceId,
    quantity: entry.quantity,
    subscriptionId: entry.subscriptionId,
    oneTimePurchaseId: entry.oneTimePurchaseId,
  };
}

function readMoneyTransferEntry(entry: Record<string, unknown>): LedgerMoneyTransferEntry {
  if (typeof entry.customerId !== "string") {
    throw new StackAssertionError("Invalid money-transfer customerId", { entry });
  }
  if (!isRecord(entry.chargedAmount)) {
    throw new StackAssertionError("Invalid money-transfer chargedAmount", { entry });
  }

  const chargedAmount: Record<string, string> = {};
  for (const [currency, amount] of Object.entries(entry.chargedAmount)) {
    if (typeof amount === "string") {
      chargedAmount[currency] = amount;
    }
  }

  return {
    type: "money-transfer",
    customerType: readCustomerType(entry.customerType, "money-transfer entry"),
    customerId: entry.customerId,
    chargedAmount,
  };
}

function readItemQuantityChangeEntry(entry: Record<string, unknown>): LedgerItemQuantityChangeEntry {
  if (typeof entry.customerId !== "string" || typeof entry.itemId !== "string" || typeof entry.quantity !== "number") {
    throw new StackAssertionError("Invalid item-quantity-change entry", { entry });
  }

  return {
    type: "item-quantity-change",
    customerType: readCustomerType(entry.customerType, "item-quantity-change entry"),
    customerId: entry.customerId,
    itemId: entry.itemId,
    quantity: entry.quantity,
  };
}

function mapMoneyTransferEntry(entry: LedgerMoneyTransferEntry): Extract<TransactionEntry, { type: "money_transfer" }> | null {
  const chargedAmount = entry.chargedAmount;
  if (Object.keys(chargedAmount).length === 0) {
    return null;
  }
  return {
    type: "money_transfer",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: entry.customerType,
    customer_id: entry.customerId,
    charged_amount: chargedAmount,
    net_amount: {
      USD: "USD" in chargedAmount ? chargedAmount.USD : "0",
    },
  };
}

function mapProductGrantEntry(entry: LedgerProductGrantEntry): Extract<TransactionEntry, { type: "product_grant" }> {
  return {
    type: "product_grant",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: entry.customerType,
    customer_id: entry.customerId,
    product_id: entry.productId,
    product: mapProductSnapshotToInlineProduct(entry.product),
    price_id: entry.priceId ?? null,
    quantity: entry.quantity,
    ...(entry.subscriptionId != null ? { subscription_id: entry.subscriptionId } : {}),
    ...(entry.oneTimePurchaseId != null ? { one_time_purchase_id: entry.oneTimePurchaseId } : {}),
  };
}

function mapItemQuantityChangeEntry(entry: LedgerItemQuantityChangeEntry): Extract<TransactionEntry, { type: "item_quantity_change" }> {
  return {
    type: "item_quantity_change",
    adjusted_transaction_id: null,
    adjusted_entry_index: null,
    customer_type: entry.customerType,
    customer_id: entry.customerId,
    item_id: entry.itemId,
    quantity: entry.quantity,
  };
}

function mapLedgerEntry(entry: unknown): TransactionEntry | null {
  if (!isRecord(entry)) {
    throw new StackAssertionError("Invalid ledger entry value", { entry });
  }
  const type = entry.type;
  if (typeof type !== "string") {
    throw new StackAssertionError("Missing ledger entry type", { entry });
  }

  if (type === "money-transfer") {
    return mapMoneyTransferEntry(readMoneyTransferEntry(entry));
  }
  if (type === "item-quantity-change") {
    return mapItemQuantityChangeEntry(readItemQuantityChangeEntry(entry));
  }
  if (type === "product-grant") {
    return mapProductGrantEntry(readProductGrantEntry(entry));
  }
  if (type === "product-revocation") {
    const adjustedTransactionId = entry.adjustedTransactionId;
    const adjustedEntryIndex = entry.adjustedEntryIndex;
    const quantity = entry.quantity;
    if (
      typeof adjustedTransactionId !== "string" ||
      typeof adjustedEntryIndex !== "number" ||
      !Number.isInteger(adjustedEntryIndex) ||
      adjustedEntryIndex < 0 ||
      typeof quantity !== "number"
    ) {
      throw new StackAssertionError("Invalid product-revocation entry", { entry });
    }
    return {
      type: "product_revocation",
      adjusted_transaction_id: adjustedTransactionId,
      adjusted_entry_index: adjustedEntryIndex,
      quantity,
    };
  }
  if (type === "product-revocation-reversal") {
    const adjustedTransactionId = entry.adjustedTransactionId;
    const adjustedEntryIndex = entry.adjustedEntryIndex;
    const quantity = entry.quantity;
    if (
      typeof adjustedTransactionId !== "string" ||
      typeof adjustedEntryIndex !== "number" ||
      !Number.isInteger(adjustedEntryIndex) ||
      adjustedEntryIndex < 0 ||
      typeof quantity !== "number"
    ) {
      throw new StackAssertionError("Invalid product-revocation-reversal entry", { entry });
    }
    return {
      type: "product_revocation_reversal",
      adjusted_transaction_id: adjustedTransactionId,
      adjusted_entry_index: adjustedEntryIndex,
      quantity,
    };
  }

  // TODO: These entries are currently not exposed in getTransactions, but we should fix that
  if (
    type === "active-subscription-change" ||
    type === "active-subscription-end" ||
    type === "active-subscription-start" ||
    type === "item-quantity-expire" ||
    type === "compacted-item-quantity-change"
  ) {
    return null;
  }

  throw new StackAssertionError("Unexpected ledger entry type", { entry });
}

function mapLedgerTransactionTypeToApiType(type: LedgerTransactionType): Transaction["type"] {
  if (type === "manual-item-quantity-change") {
    return "manual-item-quantity-change";
  }
  if (type === "subscription-renewal") {
    return "subscription-renewal";
  }
  return "purchase";
}

function buildAdjustedByFromRefunds(options: {
  row: QueriedLedgerTransactionRow,
  adjustedByLookup: Map<string, Transaction["adjusted_by"]>,
}): Transaction["adjusted_by"] {
  const adjustedByFromRefunds = options.adjustedByLookup.get(options.row.txnId);
  return adjustedByFromRefunds ?? [];
}

function buildAdjustedByLookupFromRefundRows(rows: unknown[]): Map<string, Transaction["adjusted_by"]> {
  const lookup = new Map<string, Transaction["adjusted_by"]>();
  for (const rowData of rows) {
    if (!isRecord(rowData)) {
      throw new StackAssertionError("Refund transaction rowData is not an object", { rowData });
    }
    const refundTxnId = Reflect.get(rowData, "txnId");
    const entries = Reflect.get(rowData, "entries");
    if (typeof refundTxnId !== "string" || refundTxnId.length === 0) {
      throw new StackAssertionError("Refund transaction row is missing txnId", { rowData });
    }
    if (!Array.isArray(entries)) {
      throw new StackAssertionError("Refund transaction row has invalid entries", { rowData });
    }
    for (const entry of entries) {
      if (!isRecord(entry)) {
        throw new StackAssertionError("Refund transaction entry is not an object", { entry, rowData });
      }
      if (entry.type !== "product-revocation") {
        continue;
      }
      const adjustedTransactionId = Reflect.get(entry, "adjustedTransactionId");
      const adjustedEntryIndex = Reflect.get(entry, "adjustedEntryIndex");
      if (
        typeof adjustedTransactionId !== "string" ||
        adjustedTransactionId.length === 0 ||
        typeof adjustedEntryIndex !== "number" ||
        !Number.isInteger(adjustedEntryIndex) ||
        adjustedEntryIndex < 0
      ) {
        throw new StackAssertionError("Refund transaction has invalid product-revocation back reference", {
          entry,
          rowData,
        });
      }
      const existing = lookup.get(adjustedTransactionId) ?? [];
      lookup.set(adjustedTransactionId, [
        ...existing,
        {
          transaction_id: refundTxnId,
          entry_index: adjustedEntryIndex,
        },
      ]);
    }
  }
  return lookup;
}

async function getTransactions(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  limit: number,
  cursor: string | undefined,
  type: TransactionType | undefined,
  customerType: "user" | "team" | "custom" | undefined,
}): Promise<{ transactions: Transaction[], nextCursor: string | null }> {
  const ledgerTypes = getLedgerTypesForFilter(options.type);
  if (ledgerTypes.length === 0) {
    return { transactions: [], nextCursor: null };
  }

  const decodedCursor = options.cursor ? parseCursor(options.cursor) : null;
  const baseSql = toQueryableSqlQuery(schema.transactions.listRowsInGroup({
    start: "start",
    end: "end",
    startInclusive: true,
    endInclusive: true,
  }));

  const whereClauses = [
    `"__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}`,
    `"__rows"."rowdata"->>'type' IN (${ledgerTypes.map((value) => quoteSqlStringLiteral(value).sql).join(", ")})`,
  ];
  if (options.customerType) {
    whereClauses.push(`"__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}`);
  }
  if (decodedCursor) {
    whereClauses.push(`(
      (("__rows"."rowdata"->>'createdAtMillis')::bigint < ${decodedCursor.createdAtMillis})
      OR (
        (("__rows"."rowdata"->>'createdAtMillis')::bigint = ${decodedCursor.createdAtMillis})
        AND ("__rows"."rowdata"->>'txnId') < ${quoteSqlStringLiteral(decodedCursor.txnId).sql}
      )
    )`);
  }

  const sql = `
    SELECT "__rows"."rowdata" AS "rowData"
    FROM (${baseSql}) AS "__rows"
    WHERE ${whereClauses.join("\n      AND ")}
    ORDER BY
      (("__rows"."rowdata"->>'createdAtMillis')::bigint) DESC,
      ("__rows"."rowdata"->>'txnId') DESC
    LIMIT ${options.limit + 1}
  `;

  const rawRows = await options.prisma.$queryRaw<Array<{ rowData: unknown }>>`${Prisma.raw(sql)}`;
  const parsedRows = rawRows.map((row) => {
    const parsed = readLedgerTransactionRow(row.rowData);
    return {
      ...parsed,
      sourceId: parseSourceId(parsed),
    } satisfies QueriedLedgerTransactionRow;
  });
  const seenTxnIds = new Set<string>();
  for (const row of parsedRows) {
    if (seenTxnIds.has(row.txnId)) {
      throw new StackAssertionError("Duplicate transaction id returned from grouped transactions table", {
        txnId: row.txnId,
        tenancyId: options.tenancyId,
      });
    }
    seenTxnIds.add(row.txnId);
  }

  const hasMore = parsedRows.length > options.limit;
  const pageRows = hasMore ? parsedRows.slice(0, options.limit) : parsedRows;
  let refundRows: Array<{ rowData: unknown }> = [];
  if (pageRows.length > 0) {
    const adjustedTransactionIdsSql = pageRows.map((row) => quoteSqlStringLiteral(row.txnId).sql).join(", ");
    const refundWhereClauses = [
      `"__rows"."rowdata"->>'tenancyId' = ${quoteSqlStringLiteral(options.tenancyId).sql}`,
      `"__rows"."rowdata"->>'type' = 'refund'`,
      `EXISTS (
        SELECT 1
        FROM jsonb_array_elements("__rows"."rowdata"->'entries') AS "__entry"
        WHERE "__entry"->>'type' = 'product-revocation'
          AND "__entry"->>'adjustedTransactionId' IN (${adjustedTransactionIdsSql})
      )`,
    ];
    if (options.customerType) {
      refundWhereClauses.push(`"__rows"."rowdata"->>'customerType' = ${quoteSqlStringLiteral(options.customerType).sql}`);
    }
    const refundSql = `
      SELECT "__rows"."rowdata" AS "rowData"
      FROM (${baseSql}) AS "__rows"
      WHERE ${refundWhereClauses.join("\n        AND ")}
    `;
    refundRows = await options.prisma.$queryRaw<Array<{ rowData: unknown }>>`${Prisma.raw(refundSql)}`;
  }
  const resolvedAdjustedByLookup = buildAdjustedByLookupFromRefundRows(refundRows.map((row) => row.rowData));

  const transactions: Transaction[] = pageRows.map((row): Transaction => {
    const entries = row.entries.flatMap((entry): TransactionEntry[] => {
      const mapped = mapLedgerEntry(entry);
      return mapped ? [mapped] : [];
    });
    return {
      id: row.sourceId,
      created_at_millis: row.createdAtMillis,
      effective_at_millis: row.effectiveAtMillis,
      type: mapLedgerTransactionTypeToApiType(row.type),
      entries,
      adjusted_by: buildAdjustedByFromRefunds({
        row,
        adjustedByLookup: resolvedAdjustedByLookup,
      }),
      test_mode: row.paymentProvider === "test_mode",
    };
  });

  const nextCursor = hasMore
    ? encodeCursor({
      createdAtMillis: pageRows[pageRows.length - 1].createdAtMillis,
      txnId: pageRows[pageRows.length - 1].txnId,
    })
    : null;

  return {
    transactions,
    nextCursor,
  };
}

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
      type: yupString().oneOf(TRANSACTION_TYPES).optional(),
      customer_type: yupString().oneOf(['user', 'team', 'custom']).optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      transactions: yupArray(transactionSchema).defined(),
      next_cursor: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const rawLimit = query.limit ?? "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const { transactions, nextCursor } = await getTransactions({
      prisma,
      tenancyId: auth.tenancy.id,
      limit,
      cursor: query.cursor,
      type: query.type,
      customerType: query.customer_type,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        transactions,
        next_cursor: nextCursor,
      },
    };
  },
});
