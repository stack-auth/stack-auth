/**
 * Initializes the payments Bulldozer schema tables and ingresses existing
 * Prisma data into the stored tables.
 *
 * - Init: each table's init() is idempotent (ON CONFLICT DO NOTHING).
 * - Ingress: converts Prisma rows to bulldozer stored table rows. Skipped
 *   if data already exists (checked via a sentinel row count).
 *
 * Call from db-migrations.ts after Postgres migrations have been applied.
 */

import { Prisma } from "@/generated/prisma/client";
import { toExecutableSqlTransaction } from "@/lib/bulldozer/db/index";
import type { SqlStatement, TableId } from "@/lib/bulldozer/db/utilities";
import {
  itemQuantityChangeToStoredRow,
  oneTimePurchaseToStoredRow,
  subscriptionInvoiceToStoredRow,
  subscriptionToStoredRow,
} from "@/lib/payments/bulldozer-dual-write";
import { createPaymentsSchema } from "@/lib/payments/schema/index";
import type { ManualTransactionRow } from "@/lib/payments/schema/types";
import type { PrismaClientTransaction } from "@/prisma-client";

const schema = createPaymentsSchema();

const BATCH_SIZE = 100;

async function initTables(prisma: PrismaClientTransaction) {
  let initialized = 0;
  for (const table of schema._allTables) {
    const [{ isInit }] = await prisma.$queryRaw`
      SELECT ${Prisma.raw(table.isInitialized().sql)} AS "isInit"
    ` as [{ isInit: boolean }];
    if (isInit) {
      initialized++;
      continue;
    }
    const sql = toExecutableSqlTransaction(table.init());
    await prisma.$executeRaw`${Prisma.raw(sql)}`;
  }
  if (initialized > 0) {
    console.log(`[Bulldozer] ${initialized}/${schema._allTables.length} tables already initialized, skipped those ones.`);
  }
}

/**
 * Returns the set of row IDs already in a bulldozer stored table.
 * Used to skip re-ingressing rows that are already present.
 */
async function getExistingRowIds(prisma: PrismaClientTransaction, tableId: TableId): Promise<Set<string>> {
  if (typeof tableId !== "string") {
    throw new Error(`paginatedIngress only supports external stored tables with string tableId, got: ${JSON.stringify(tableId)}`);
  }
  const rows = await prisma.$queryRaw`
    SELECT ("keyPath"[cardinality("keyPath")] #>> '{}') AS "rowId"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = (
      SELECT "keyPath" FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb(${'external:' + tableId}::text),
        to_jsonb('storage'::text),
        to_jsonb('rows'::text)
      ]::jsonb[]
    )
  ` as Array<{ rowId: string }>;
  return new Set(rows.map(r => r.rowId));
}

async function getExistingRefundTxnIds(prisma: PrismaClientTransaction): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ txnId: string }>>`
    SELECT ("value"->'rowData'->>'txnId') AS "txnId"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = (
      SELECT "keyPath" FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb(${'external:payments-manual-transactions'}::text),
        to_jsonb('storage'::text),
        to_jsonb('rows'::text)
      ]::jsonb[]
    )
      AND "value"->'rowData'->>'type' = 'refund'
  `;
  return new Set(rows.map((r) => r.txnId));
}

function readCustomerType(value: unknown): "user" | "team" | "custom" {
  if (value === "USER") return "user";
  if (value === "TEAM") return "team";
  if (value === "CUSTOM") return "custom";
  throw new Error(`Unexpected customerType while backfilling refund manual transactions: ${JSON.stringify(value)}`);
}

function readProductLineId(product: unknown): string | null {
  if (typeof product !== "object" || product === null || Array.isArray(product)) {
    return null;
  }
  const productLineId = Reflect.get(product, "productLineId");
  return typeof productLineId === "string" ? productLineId : null;
}

type RefundedSourceRow = {
  id: string,
  tenancyId: string,
  customerId: string,
  customerType: "USER" | "TEAM" | "CUSTOM",
  productId: string | null,
  product: unknown,
  quantity: number,
  creationSource: string,
  refundedAt: Date | null,
};

function assertRefundedSourceRow(row: any, tableName: "Subscription" | "OneTimePurchase"): asserts row is RefundedSourceRow {
  if (
    typeof row.id !== "string" ||
    typeof row.tenancyId !== "string" ||
    typeof row.customerId !== "string" ||
    (row.customerType !== "USER" && row.customerType !== "TEAM" && row.customerType !== "CUSTOM") ||
    !(typeof row.productId === "string" || row.productId === null) ||
    typeof row.quantity !== "number" ||
    typeof row.creationSource !== "string" ||
    !(row.refundedAt instanceof Date || row.refundedAt === null)
  ) {
    throw new Error(`Unexpected ${tableName} row shape while backfilling refund manual transactions`);
  }
}

function buildBackfilledRefundManualTransaction(options: {
  row: RefundedSourceRow,
  sourceKind: "subscription" | "one-time-purchase",
  adjustedTransactionId: string,
  adjustedEntryIndex: number,
}): { rowId: string, rowData: ManualTransactionRow } {
  if (!options.row.refundedAt) {
    throw new Error("buildBackfilledRefundManualTransaction called for non-refunded row");
  }
  const refundedAtMillis = options.row.refundedAt.getTime();
  const customerType = readCustomerType(options.row.customerType);
  return {
    rowId: `refund:${options.sourceKind}:${options.row.id}`,
    rowData: {
      txnId: `${options.row.id}:refund`,
      tenancyId: options.row.tenancyId,
      effectiveAtMillis: refundedAtMillis,
      type: "refund",
      entries: [{
        type: "product-revocation",
        customerType,
        customerId: options.row.customerId,
        adjustedTransactionId: options.adjustedTransactionId,
        adjustedEntryIndex: options.adjustedEntryIndex,
        quantity: options.row.quantity,
        productId: options.row.productId,
        productLineId: readProductLineId(options.row.product),
      }],
      customerType,
      customerId: options.row.customerId,
      paymentProvider: options.row.creationSource === "TEST_MODE" ? "test_mode" : "stripe",
      createdAtMillis: refundedAtMillis,
    },
  };
}

type RefundManualIngressState = {
  existingRowIds: Set<string>,
  existingTxnIds: Set<string>,
  ingressed: number,
  skipped: number,
};

async function createRefundManualIngressState(prisma: PrismaClientTransaction): Promise<RefundManualIngressState> {
  return {
    existingRowIds: await getExistingRowIds(prisma, schema.manualTransactions.tableId),
    existingTxnIds: await getExistingRefundTxnIds(prisma),
    ingressed: 0,
    skipped: 0,
  };
}

async function writeBackfilledRefundManualTransaction(
  prisma: PrismaClientTransaction,
  transaction: { rowId: string, rowData: ManualTransactionRow },
  state: RefundManualIngressState,
) {
  if (state.existingRowIds.has(transaction.rowId) || state.existingTxnIds.has(transaction.rowData.txnId)) {
    state.skipped++;
    return;
  }
  const rowDataJson = JSON.stringify(transaction.rowData).replaceAll("'", "''");
  const sql = toExecutableSqlTransaction(
    schema.manualTransactions.setRow(transaction.rowId, { type: "expression", sql: `'${rowDataJson}'::jsonb` })
  );
  await prisma.$executeRaw`${Prisma.raw(sql)}`;
  state.existingRowIds.add(transaction.rowId);
  state.existingTxnIds.add(transaction.rowData.txnId);
  state.ingressed++;
}

/**
 * Cursor-based paginated ingress. Fetches rows from `tableName` in batches
 * using the composite PK (tenancyId, id) for cursor ordering (matches the
 * `@@id([tenancyId, id])` index on all four tables), skips rows already
 * present in Bulldozer, and calls `storedTable.setRow()` for each new row.
 */
async function paginatedIngress(
  prisma: PrismaClientTransaction,
  tableName: string,
  storedTable: { tableId: TableId, setRow(id: string, data: { type: "expression", sql: string }): SqlStatement[] },
  toRowData: (row: any) => Record<string, unknown>,
  options: {
    afterEachRow?: (row: any) => Promise<void>,
  } = {},
) {
  const existingIds = await getExistingRowIds(prisma, storedTable.tableId);
  let ingressed = 0;
  let skipped = 0;
  let cursorTenancyId: string | null = null;
  let cursorId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cursor-based pagination loop
  while (true) {
    // any[] because Prisma $queryRaw returns unknown and we destructure dynamically
    const batch: any[] = cursorTenancyId != null
      ? await prisma.$queryRawUnsafe(
        `SELECT * FROM "${tableName}" WHERE ("tenancyId", "id") > ($1::uuid, $2::uuid) ORDER BY "tenancyId", "id" LIMIT ${BATCH_SIZE}`,
        cursorTenancyId,
        cursorId,
      )
      : await prisma.$queryRawUnsafe(
        `SELECT * FROM "${tableName}" ORDER BY "tenancyId", "id" LIMIT ${BATCH_SIZE}`,
      );
    if (batch.length === 0) break;
    const lastRow = batch[batch.length - 1];
    cursorTenancyId = lastRow.tenancyId;
    cursorId = lastRow.id;

    for (const row of batch) {
      if (existingIds.has(row.id)) {
        skipped++;
      } else {
        const rowData = JSON.stringify(toRowData(row)).replaceAll("'", "''");
        const sql = toExecutableSqlTransaction(
          storedTable.setRow(row.id, { type: "expression", sql: `'${rowData}'::jsonb` })
        );
        await prisma.$executeRaw`${Prisma.raw(sql)}`;
        ingressed++;
      }
      if (options.afterEachRow) {
        await options.afterEachRow(row);
      }
    }
  }
  console.log(`[Bulldozer] Ingressed ${ingressed} ${tableName} rows (${skipped} already present).`);
}

export async function runBulldozerPaymentsInit(prisma: PrismaClientTransaction) {
  console.log("[Bulldozer] Initializing payments schema tables...");
  await initTables(prisma);
  console.log(`[Bulldozer] Initialized ${schema._allTables.length} payments tables.`);

  console.log("[Bulldozer] Syncing Prisma data into bulldozer stored tables...");
  const refundManualIngressState = await createRefundManualIngressState(prisma);

  await paginatedIngress(
    prisma,
    "Subscription",
    schema.subscriptions,
    subscriptionToStoredRow,
    {
      afterEachRow: async (row) => {
        assertRefundedSourceRow(row, "Subscription");
        if (row.refundedAt == null) {
          return;
        }
        const refundManualTransaction = buildBackfilledRefundManualTransaction({
          row,
          sourceKind: "subscription",
          adjustedTransactionId: `sub-start:${row.id}`,
          adjustedEntryIndex: 1,
        });
        await writeBackfilledRefundManualTransaction(prisma, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(prisma, "SubscriptionInvoice", schema.subscriptionInvoices, subscriptionInvoiceToStoredRow);
  await paginatedIngress(
    prisma,
    "OneTimePurchase",
    schema.oneTimePurchases,
    oneTimePurchaseToStoredRow,
    {
      afterEachRow: async (row) => {
        assertRefundedSourceRow(row, "OneTimePurchase");
        if (row.refundedAt == null) {
          return;
        }
        const refundManualTransaction = buildBackfilledRefundManualTransaction({
          row,
          sourceKind: "one-time-purchase",
          adjustedTransactionId: `otp:${row.id}`,
          adjustedEntryIndex: 0,
        });
        await writeBackfilledRefundManualTransaction(prisma, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(prisma, "ItemQuantityChange", schema.manualItemQuantityChanges, itemQuantityChangeToStoredRow);
  console.log(`[Bulldozer] Ingressed ${refundManualIngressState.ingressed} refund manual transactions (${refundManualIngressState.skipped} already present).`);

  console.log("[Bulldozer] Payments data ingress complete.");
}
