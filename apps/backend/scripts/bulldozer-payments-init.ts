/**
 * Initializes the payments Bulldozer schema tables in the database.
 *
 * Each table's init() is idempotent (ON CONFLICT DO NOTHING), so this
 * is safe to run on every migration. Call from db-migrations.ts after
 * Postgres migrations have been applied.
 */

import { Prisma } from "@/generated/prisma/client";
import { toExecutableSqlTransaction } from "@/lib/bulldozer/db/index";
import { createPaymentsSchema } from "@/lib/payments/schema/index";
import type { PrismaClientTransaction } from "@/prisma-client";

export async function runBulldozerPaymentsInit(prisma: PrismaClientTransaction) {
  console.log("[Bulldozer] Initializing payments schema tables...");
  const schema = createPaymentsSchema();

  for (const table of schema._allTables) {
    const sql = toExecutableSqlTransaction(table.init());
    await prisma.$executeRaw`${Prisma.raw(sql)}`;
  }

  console.log(`[Bulldozer] Initialized ${schema._allTables.length} payments tables.`);
}
