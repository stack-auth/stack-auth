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

import { createBulldozerExecutionContext, toExecutableSqlTransaction, type BulldozerExecutionContext } from "../lib/bulldozer/db";
import type { SqlStatement, TableId } from "../lib/bulldozer/db/utilities";
import { executeRaw, queryRaw, queryRawUnsafe } from "../db";
import {
  itemQuantityChangeToStoredRow,
  oneTimePurchaseToStoredRow,
  subscriptionInvoiceToStoredRow,
  subscriptionToStoredRow,
} from "./stored-row-converters";
import { createPaymentsSchema } from "./schema/index";
import type { ManualTransactionRow } from "./schema/types";

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

async function initTables(ctx: BulldozerExecutionContext) {
  let initialized = 0;
  for (const table of schema._allTables) {
    const [{ isInit }] = await queryRaw<Array<{ isInit: boolean }>>(`SELECT ${table.isInitialized(ctx).sql} AS "isInit"`);
    if (isInit) {
      initialized++;
      continue;
    }
    const sql = toExecutableSqlTransaction(ctx, table.init(ctx));
    await executeRaw(sql);
  }
  if (initialized > 0) {
    console.log(`[Bulldozer] ${initialized}/${schema._allTables.length} tables already initialized, skipped those ones.`);
  }
}

async function repairInitializedTableStorageParents() {
  await executeRaw(`
    BEGIN;

    WITH initialized_tables AS (
      SELECT DISTINCT "keyPath"[1:2] AS "tablePath"
      FROM "BulldozerStorageEngine"
      WHERE cardinality("keyPath") = 4
        AND "keyPath"[1] = to_jsonb('table'::text)
        AND "keyPath"[3] = to_jsonb('storage'::text)
        AND "keyPath"[4] = to_jsonb('metadata'::text)
    )
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    SELECT gen_random_uuid(), "tablePath", 'null'::jsonb
    FROM initialized_tables
    ON CONFLICT ("keyPath") DO NOTHING;

    WITH initialized_tables AS (
      SELECT DISTINCT "keyPath"[1:2] AS "tablePath"
      FROM "BulldozerStorageEngine"
      WHERE cardinality("keyPath") = 4
        AND "keyPath"[1] = to_jsonb('table'::text)
        AND "keyPath"[3] = to_jsonb('storage'::text)
        AND "keyPath"[4] = to_jsonb('metadata'::text)
    )
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    SELECT gen_random_uuid(), "tablePath" || ARRAY[to_jsonb('storage'::text)], 'null'::jsonb
    FROM initialized_tables
    ON CONFLICT ("keyPath") DO NOTHING;

    WITH initialized_tables AS (
      SELECT DISTINCT "keyPath"[1:2] AS "tablePath"
      FROM "BulldozerStorageEngine"
      WHERE cardinality("keyPath") = 4
        AND "keyPath"[1] = to_jsonb('table'::text)
        AND "keyPath"[3] = to_jsonb('storage'::text)
        AND "keyPath"[4] = to_jsonb('metadata'::text)
    )
    INSERT INTO "BulldozerStorageEngine" ("id", "keyPath", "value")
    SELECT gen_random_uuid(), "tablePath" || ARRAY[to_jsonb('storage'::text), to_jsonb('rows'::text)], 'null'::jsonb
    FROM initialized_tables
    ON CONFLICT ("keyPath") DO NOTHING;

    COMMIT;
  `);
}

/**
 * Returns the set of row IDs already in a bulldozer stored table.
 * Used to skip re-ingressing rows that are already present.
 */
async function getExistingRowIds(tableId: TableId): Promise<Set<string>> {
  if (typeof tableId !== "string") {
    throw new Error(`paginatedIngress only supports external stored tables with string tableId, got: ${JSON.stringify(tableId)}`);
  }
  const rows = await queryRawUnsafe<Array<{ rowId: string }>>(`
    SELECT ("keyPath"[cardinality("keyPath")] #>> '{}') AS "rowId"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = (
      SELECT "keyPath" FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb($1::text),
        to_jsonb('storage'::text),
        to_jsonb('rows'::text)
      ]::jsonb[]
    )
  `, [`external:${tableId}`]);
  return new Set(rows.map(r => r.rowId));
}

async function getExistingRefundTxnIds(): Promise<Set<string>> {
  const rows = await queryRaw<Array<{ txnId: string }>>(`
    SELECT ("value"->'rowData'->>'txnId') AS "txnId"
    FROM "BulldozerStorageEngine"
    WHERE "keyPathParent" = (
      SELECT "keyPath" FROM "BulldozerStorageEngine"
      WHERE "keyPath" = ARRAY[
        to_jsonb('table'::text),
        to_jsonb('external:payments-manual-transactions'::text),
        to_jsonb('storage'::text),
        to_jsonb('rows'::text)
      ]::jsonb[]
    )
      AND "value"->'rowData'->>'type' = 'refund'
  `);
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

async function createRefundManualIngressState(): Promise<RefundManualIngressState> {
  const state = {
    existingRowIds: await getExistingRowIds(schema.manualTransactions.tableId),
    existingTxnIds: await getExistingRefundTxnIds(),
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
  await executeRaw(sql);

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
  const existingIds = await getExistingRowIds(storedTable.tableId);
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
    const batch: any[] = cursorTenancyId != null
      ? await queryRawUnsafe(
        `SELECT * FROM "${tableName}" WHERE ("tenancyId", "id") > ($1::uuid, $2::uuid) ORDER BY "tenancyId", "id" LIMIT ${BATCH_SIZE}`,
        [cursorTenancyId, cursorId],
      )
      : await queryRawUnsafe(
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
          await executeRaw(sql);
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

export async function runBulldozerPaymentsInit() {
  const ctx = createBulldozerExecutionContext();
  console.log("[Bulldozer] Initializing payments schema tables...");
  await initTables(ctx);
  await repairInitializedTableStorageParents();
  console.log(`[Bulldozer] Initialized ${schema._allTables.length} payments tables.`);

  console.log("[Bulldozer] Syncing Prisma data into bulldozer stored tables...");
  const refundManualIngressState = await createRefundManualIngressState();

  await paginatedIngress(
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
        await writeBackfilledRefundManualTransaction(ctx, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(ctx, "SubscriptionInvoice", schema.subscriptionInvoices, subscriptionInvoiceToStoredRow);
  await paginatedIngress(
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
        await writeBackfilledRefundManualTransaction(ctx, refundManualTransaction, refundManualIngressState);
      },
    }
  );
  await paginatedIngress(ctx, "ItemQuantityChange", schema.manualItemQuantityChanges, itemQuantityChangeToStoredRow);
  console.log(`[Bulldozer] Ingressed ${refundManualIngressState.ingressed} refund manual transactions (${refundManualIngressState.skipped} already present).`);

  console.log("[Bulldozer] Payments data ingress complete.");
}
