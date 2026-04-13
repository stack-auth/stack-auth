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
import { createPaymentsSchema } from "@/lib/payments/schema/index";
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

function dateToMillis(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

function customerTypeToLower(ct: string): string {
  return ct.toLowerCase();
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
        continue;
      }
      const rowData = JSON.stringify(toRowData(row)).replaceAll("'", "''");
      const sql = toExecutableSqlTransaction(
        storedTable.setRow(row.id, { type: "expression", sql: `'${rowData}'::jsonb` })
      );
      await prisma.$executeRaw`${Prisma.raw(sql)}`;
      ingressed++;
    }
  }
  console.log(`[Bulldozer] Ingressed ${ingressed} ${tableName} rows (${skipped} already present).`);
}

export async function runBulldozerPaymentsInit(prisma: PrismaClientTransaction) {
  console.log("[Bulldozer] Initializing payments schema tables...");
  await initTables(prisma);
  console.log(`[Bulldozer] Initialized ${schema._allTables.length} payments tables.`);

  console.log("[Bulldozer] Syncing Prisma data into bulldozer stored tables...");

  await paginatedIngress(prisma, "Subscription", schema.subscriptions, (sub) => ({
    id: sub.id,
    tenancyId: sub.tenancyId,
    customerId: sub.customerId,
    customerType: customerTypeToLower(sub.customerType),
    productId: sub.productId,
    priceId: sub.priceId,
    product: sub.product,
    quantity: sub.quantity,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    status: sub.status.toLowerCase(),
    currentPeriodStartMillis: dateToMillis(sub.currentPeriodStart),
    currentPeriodEndMillis: dateToMillis(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    endedAtMillis: dateToMillis(sub.endedAt),
    refundedAtMillis: dateToMillis(sub.refundedAt),
    creationSource: sub.creationSource,
    createdAtMillis: dateToMillis(sub.createdAt),
  }));

  await paginatedIngress(prisma, "SubscriptionInvoice", schema.subscriptionInvoices, (inv) => ({
    id: inv.id,
    tenancyId: inv.tenancyId,
    stripeSubscriptionId: inv.stripeSubscriptionId,
    stripeInvoiceId: inv.stripeInvoiceId,
    isSubscriptionCreationInvoice: inv.isSubscriptionCreationInvoice,
    status: inv.status,
    amountTotal: inv.amountTotal,
    hostedInvoiceUrl: inv.hostedInvoiceUrl,
    createdAtMillis: dateToMillis(inv.createdAt),
  }));

  await paginatedIngress(prisma, "OneTimePurchase", schema.oneTimePurchases, (p) => ({
    id: p.id,
    tenancyId: p.tenancyId,
    customerId: p.customerId,
    customerType: customerTypeToLower(p.customerType),
    productId: p.productId,
    priceId: p.priceId,
    product: p.product,
    quantity: p.quantity,
    stripePaymentIntentId: p.stripePaymentIntentId,
    revokedAtMillis: dateToMillis(p.revokedAt),
    refundedAtMillis: dateToMillis(p.refundedAt),
    creationSource: p.creationSource,
    createdAtMillis: dateToMillis(p.createdAt),
  }));

  await paginatedIngress(prisma, "ItemQuantityChange", schema.manualItemQuantityChanges, (c) => ({
    id: c.id,
    tenancyId: c.tenancyId,
    customerId: c.customerId,
    customerType: customerTypeToLower(c.customerType),
    itemId: c.itemId,
    quantity: c.quantity,
    description: c.description ?? null,
    expiresAtMillis: dateToMillis(c.expiresAt),
    createdAtMillis: dateToMillis(c.createdAt),
  }));

  console.log("[Bulldozer] Payments data ingress complete.");
}
