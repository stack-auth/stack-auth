import { prismaClient } from "@/prisma-client";
import { createSchemaMigrationTable } from "@/utils/auto-migration";

const dropSchemaMigrationTable = async () => {
  // Save existing migrations
  const existingMigrations = await prismaClient.$queryRawUnsafe<Array<{migrationName: string, startedAt: Date, finishedAt: Date}>>(
    `SELECT "migrationName", "startedAt", "finishedAt" FROM "SchemaMigration" WHERE "finishedAt" IS NOT NULL ORDER BY "startedAt" ASC`
  ).catch((error) => {
    if (error.code === 'P2010' && error.meta.code === '42P01') {
      return [];
    }
    throw error;
  });

  // Drop the table
  await prismaClient.$executeRawUnsafe(`
    DROP TABLE IF EXISTS "SchemaMigration";
  `);

  return existingMigrations;
};

const main = async () => {
  // Save migrations and drop table
  const existingMigrations = await dropSchemaMigrationTable();

  // Run prisma migrate dev to create new migration
  const { execSync } = require('child_process');
  execSync('pnpm prisma migrate dev --create-only', { stdio: 'inherit' });

  // Recreate SchemaMigration table and restore data
  await createSchemaMigrationTable();

  // Restore the migrations
  for (const migration of existingMigrations) {
    await prismaClient.$executeRawUnsafe(`
      INSERT INTO "SchemaMigration" ("migrationName", "startedAt", "finishedAt")
      VALUES ($1, $2, $3)
    `, migration.migrationName, migration.startedAt, migration.finishedAt);
  }
};

main().catch(console.error);
