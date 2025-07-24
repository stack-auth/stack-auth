import { sqlQuoteIdent } from '@/prisma-client';
import { Prisma, PrismaClient } from '@prisma/client';
import { MIGRATION_FILES } from './../generated/migration-files';

// The bigint key for the pg advisory lock
const MIGRATION_LOCK_ID = 59129034;
class MigrationNeededError extends Error {
  constructor() {
    super('MIGRATION_NEEDED');
    this.name = 'MigrationNeededError';
  }
}

function getMigrationError(error: unknown): string {
  // P2010: Raw query failed error
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
    if (error.meta?.code === 'P0001') {
      const errorName = (error.meta as { message: string }).message.split(' ')[1];
      return errorName;
    }
  }
  throw error;
}

function isMigrationNeededError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // 42P01: relation does not exist error
    if (/relation "(?:.*\.)?SchemaMigration" does not exist/.test(error.message) || /No such table: (?:.*\.)?SchemaMigration/.test(error.message)) {
      return true;
    }
  }
  if (error instanceof MigrationNeededError) {
    return true;
  }
  return false;
}

async function getAppliedMigrations(options: {
  prismaClient: PrismaClient,
  schema: string,
}) {
  const [_1, _2, _3, appliedMigrations] = await options.prismaClient.$transaction([
    options.prismaClient.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`,
    options.prismaClient.$executeRaw(Prisma.sql`
      SET search_path TO ${sqlQuoteIdent(options.schema)};
    `),
    options.prismaClient.$executeRaw`
      DO $$
      BEGIN
        CREATE TABLE IF NOT EXISTS "SchemaMigration" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
          "finishedAt" TIMESTAMP(3) NOT NULL,
          "migrationName" TEXT NOT NULL UNIQUE,
          CONSTRAINT "SchemaMigration_pkey" PRIMARY KEY ("id")
        );
        
        IF EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = '_prisma_migrations'
        ) THEN
          INSERT INTO "SchemaMigration" ("migrationName", "finishedAt")
          SELECT 
            migration_name, 
            finished_at
          FROM _prisma_migrations
          WHERE migration_name NOT IN (
            SELECT "migrationName" FROM "SchemaMigration"
          )
          AND finished_at IS NOT NULL;
        END IF;
      END $$;
    `,
    options.prismaClient.$queryRaw`SELECT "migrationName" FROM "SchemaMigration"`,
  ]);

  return (appliedMigrations as { migrationName: string }[]).map((migration) => migration.migrationName);
}

export async function applyMigrations(options: {
  prismaClient: PrismaClient,
  migrationFiles?: { migrationName: string, sql: string }[],
  artificialDelayInSeconds?: number,
  logging?: boolean,
  schema: string,
}): Promise<{
  newlyAppliedMigrationNames: string[],
}> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;
  const appliedMigrationNames = await getAppliedMigrations({ prismaClient: options.prismaClient, schema: options.schema });
  const newMigrationFiles = migrationFiles.filter(x => !appliedMigrationNames.includes(x.migrationName));

  const newlyAppliedMigrationNames = [];
  for (const migration of newMigrationFiles) {
    if (options.logging) {
      console.log(`Applying migration ${migration.migrationName}`);
    }

    const transaction = [];

    transaction.push(options.prismaClient.$executeRaw`
      SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_ID});
    `);

    transaction.push(options.prismaClient.$executeRaw(Prisma.sql`
      SET search_path TO ${sqlQuoteIdent(options.schema)};
    `));

    transaction.push(options.prismaClient.$executeRaw`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "SchemaMigration"
          WHERE "migrationName" = '${Prisma.raw(migration.migrationName)}'
        ) THEN
          RAISE EXCEPTION 'MIGRATION_ALREADY_APPLIED';
        END IF;
      END
      $$;
    `);

    for (const statement of migration.sql.split('SPLIT_STATEMENT_SENTINEL')) {
      if (statement.includes('SINGLE_STATEMENT_SENTINEL')) {
        transaction.push(options.prismaClient.$queryRaw`${Prisma.raw(statement)}`);
      } else {
        transaction.push(options.prismaClient.$executeRaw`
          DO $$
          BEGIN
            ${Prisma.raw(statement)}
          END
          $$;
        `);
      }
    }

    if (options.artificialDelayInSeconds) {
      transaction.push(options.prismaClient.$executeRaw`
        SELECT pg_sleep(${options.artificialDelayInSeconds});
      `);
    }

    transaction.push(options.prismaClient.$executeRaw`
      INSERT INTO "SchemaMigration" ("migrationName", "finishedAt")
      VALUES (${migration.migrationName}, clock_timestamp())
    `);
    try {
      await options.prismaClient.$transaction(transaction);
    } catch (e) {
      const error = getMigrationError(e);
      if (error === 'MIGRATION_ALREADY_APPLIED') {
        if (options.logging) {
          console.log(`Migration ${migration.migrationName} already applied, skipping`);
        }
        continue;
      }
      throw e;
    }

    newlyAppliedMigrationNames.push(migration.migrationName);
  }

  return { newlyAppliedMigrationNames };
};

export async function runMigrationNeeded(options: {
  prismaClient: PrismaClient,
  schema: string,
  migrationFiles?: { migrationName: string, sql: string }[],
  artificialDelayInSeconds?: number,
}): Promise<void> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;

  try {
    const result = await options.prismaClient.$queryRaw(Prisma.sql`
      SELECT * FROM ${sqlQuoteIdent(options.schema)}."SchemaMigration"
      ORDER BY "finishedAt" ASC
    `);
    for (const migration of migrationFiles) {
      if (!(result as any).includes(migration.migrationName)) {
        throw new MigrationNeededError();
      }
    }
  } catch (e) {
    if (isMigrationNeededError(e)) {
      await applyMigrations({
        prismaClient: options.prismaClient,
        migrationFiles: options.migrationFiles,
        artificialDelayInSeconds: options.artificialDelayInSeconds,
        schema: options.schema,
      });
    } else {
      throw e;
    }
  }
}
