/**
 * Initializes the payments Bulldozer schema tables and ingresses existing
 * Prisma data into the stored tables.
 *
 * - Init: each table's init() is NOT idempotent (no ON CONFLICT); we guard
 *   with isInitialized() checks per-table to skip already-initialized tables.
 * - Ingress: converts Prisma rows to bulldozer stored table rows. Skipped
 *   if data already exists (checked via a sentinel row count).
 *
 * Call from db-migrations.ts after Postgres migrations have been applied.
 */

import { Prisma } from "@/generated/prisma/client";
import { createBulldozerExecutionContext, toExecutableSqlTransaction, type BulldozerExecutionContext } from "@/lib/bulldozer/db/index";
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

type LogMetaValue = string | number | boolean | null | undefined;

function formatLogMeta(meta: Record<string, LogMetaValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function logIngressStep(tableName: string, step: string, meta: Record<string, LogMetaValue> = {}) {
  console.log(`[Bulldozer][Ingress][${tableName}] ${step}${formatLogMeta(meta)}`);
}

function logRowIngressStep(tableName: string, rowId: string, step: string, meta: Record<string, LogMetaValue> = {}) {
  console.log(`[Bulldozer][Ingress][${tableName}][row=${rowId}] ${step}${formatLogMeta(meta)}`);
}

async function initTables(prisma: PrismaClientTransaction, ctx: BulldozerExecutionContext) {
  let initialized = 0;
  for (const table of schema._allTables) {
    const [{ isInit }] = await prisma.$queryRaw`
      SELECT ${Prisma.raw(table.isInitialized(ctx).sql)} AS "isInit"
    ` as [{ isInit: boolean }];
    if (isInit) {
      initialized++;
      continue;
    }
    const sql = toExecutableSqlTransaction(ctx, table.init(ctx));
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
  const state = {
    existingRowIds: await getExistingRowIds(prisma, schema.manualTransactions.tableId),
    existingTxnIds: await getExistingRefundTxnIds(prisma),
    ingressed: 0,
    skipped: 0,
  };
  logIngressStep("ManualTransactions(refund)", "loaded existing refund ingress state", {
    existingRowIds: state.existingRowIds.size,
    existingTxnIds: state.existingTxnIds.size,
  });
  return state;
}

async function writeBackfilledRefundManualTransaction(
  prisma: PrismaClientTransaction,
  ctx: BulldozerExecutionContext,
  transaction: { rowId: string, rowData: ManualTransactionRow },
  state: RefundManualIngressState,
) {
  const rowAlreadyExists = state.existingRowIds.has(transaction.rowId);
  const txnAlreadyExists = state.existingTxnIds.has(transaction.rowData.txnId);
  if (rowAlreadyExists || txnAlreadyExists) {
    state.skipped++;
    return;
  }

  const rowDataJson = JSON.stringify(transaction.rowData).replaceAll("'", "''");
  const sql = toExecutableSqlTransaction(
    ctx,
    schema.manualTransactions.setRow(ctx, transaction.rowId, { type: "expression", sql: `'${rowDataJson}'::jsonb` }),
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
  ctx: BulldozerExecutionContext,
  tableName: string,
  storedTable: { tableId: TableId, setRow(ctx: BulldozerExecutionContext, id: string, data: { type: "expression", sql: string }): SqlStatement[] },
  toRowData: (row: any) => Record<string, unknown>,
  options: {
    afterEachRow?: (row: any) => Promise<void>,
  } = {},
) {
  logIngressStep(tableName, "starting paginated ingress", {
    batchSize: BATCH_SIZE,
  });
  const existingIds = await getExistingRowIds(prisma, storedTable.tableId);
  logIngressStep(tableName, "loaded existing row IDs", {
    existingCount: existingIds.size,
  });

  let ingressed = 0;
  let skipped = 0;
  let processed = 0;
  let batchNumber = 0;
  let cursorTenancyId: string | null = null;
  let cursorId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cursor-based pagination loop
  while (true) {
    batchNumber++;
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

    if (batch.length === 0) {
      break;
    }

    const lastRow = batch[batch.length - 1];
    cursorTenancyId = lastRow.tenancyId;
    cursorId = lastRow.id;

    for (let batchRowIndex = 0; batchRowIndex < batch.length; batchRowIndex++) {
      const row = batch[batchRowIndex];
      const rowId = typeof row.id === "string" ? row.id : String(row.id);
      processed++;
      const rowStartMs = performance.now();
      let rowStatus: "ingressed" | "skipped" | "failed" = "failed";
      let rowError: string | undefined = undefined;
      logRowIngressStep(tableName, rowId, "start processing row", {
        batchNumber,
        batchRowIndex,
        processedCount: processed,
      });

      try {
        const rowAlreadyExists = existingIds.has(row.id);

        if (rowAlreadyExists) {
          skipped++;
          rowStatus = "skipped";
        } else {
          const rowDataObject = toRowData(row);
          const rowData = JSON.stringify(rowDataObject).replaceAll("'", "''");
          const sql = toExecutableSqlTransaction(
            ctx,
            storedTable.setRow(ctx, row.id, { type: "expression", sql: `'${rowData}'::jsonb` }),
          );
          await prisma.$executeRaw`${Prisma.raw(sql)}`;
          ingressed++;
          rowStatus = "ingressed";
        }

        if (options.afterEachRow) {
          await options.afterEachRow(row);
        }
      } catch (error) {
        rowStatus = "failed";
        rowError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        const elapsedMs = Number((performance.now() - rowStartMs).toFixed(2));
        logRowIngressStep(tableName, rowId, "end processing row", {
          status: rowStatus,
          elapsedMs,
          batchNumber,
          batchRowIndex,
          processedCount: processed,
          ingressedCount: ingressed,
          skippedCount: skipped,
          error: rowError,
        });
      }

    }
  }

  logIngressStep(tableName, "paginated ingress complete", {
    processedCount: processed,
    ingressedCount: ingressed,
    skippedCount: skipped,
  });
  console.log(`[Bulldozer] Ingressed ${ingressed} ${tableName} rows (${skipped} already present).`);
}

export async function runBulldozerPaymentsInit(prisma: PrismaClientTransaction) {
  const ctx = createBulldozerExecutionContext();
  console.log("[Bulldozer] Initializing payments schema tables...");
  await initTables(prisma, ctx);
  console.log(`[Bulldozer] Initialized ${schema._allTables.length} payments tables.`);

  console.log("[Bulldozer] Syncing Prisma data into bulldozer stored tables...");
  const refundManualIngressState = await createRefundManualIngressState(prisma);

  await paginatedIngress(
    prisma,
    ctx,
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
        await writeBackfilledRefundManualTransaction(prisma, ctx, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(prisma, ctx, "SubscriptionInvoice", schema.subscriptionInvoices, subscriptionInvoiceToStoredRow);
  await paginatedIngress(
    prisma,
    ctx,
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
        await writeBackfilledRefundManualTransaction(prisma, ctx, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(prisma, ctx, "ItemQuantityChange", schema.manualItemQuantityChanges, itemQuantityChangeToStoredRow);
  console.log(`[Bulldozer] Ingressed ${refundManualIngressState.ingressed} refund manual transactions (${refundManualIngressState.skipped} already present).`);

  console.log("[Bulldozer] Payments data ingress complete.");
}
