import { Prisma, PrismaClient } from '@prisma/client';
import { MIGRATION_FILES } from './../generated/migration-files';


function getMigrationError(error: unknown): string {
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
    if (error.message.includes('42P01') && error.message.includes('relation "SchemaMigration" does not exist')) {
      return true;
    }
  }
  if (error instanceof Error && error.message === 'MIGRATION_NEEDED') {
    return true;
  }
  return false;
}

async function getAppliedMigrations(options: {
  prismaClient: PrismaClient,
}) {
  const [_1, appliedMigrations] = await options.prismaClient.$transaction([
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
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = '_prisma_migrations'
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
}): Promise<{
  newlyAppliedMigrationNames: string[],
}> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;
  const appliedMigrationNames = await getAppliedMigrations({ prismaClient: options.prismaClient });
  const newMigrationFiles = migrationFiles.filter(x => !appliedMigrationNames.includes(x.migrationName));

  for (const migration of newMigrationFiles) {
    if (options.logging) {
      console.log(`Applying migration ${migration.migrationName}`);
    }

    const transaction = [];

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

    transaction.push(options.prismaClient.$executeRaw`
      INSERT INTO "SchemaMigration" ("migrationName", "finishedAt")
      VALUES (${migration.migrationName}, clock_timestamp())
    `);

    await options.prismaClient.$transaction(transaction);
  }

  if (options.artificialDelayInSeconds) {
    await options.prismaClient.$executeRaw`
      SELECT pg_sleep(${options.artificialDelayInSeconds});
    `;
  }

  return { newlyAppliedMigrationNames: newMigrationFiles.map(x => x.migrationName) };
};

export function getMigrationCheckQuery() {
  return Prisma.raw(`
    SELECT * FROM "SchemaMigration"
    ORDER BY "finishedAt" ASC
  `);
}

export async function runQueryAndMigrateIfNeeded<T>(options: {
  prismaClient: PrismaClient,
  migrationFiles?: { migrationName: string, sql: string }[],
  fn: () => Promise<T>,
  artificialDelayInSeconds?: number,
}): Promise<T> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;

  try {
    const result = await options.fn();
    for (const migration of migrationFiles) {
      if (!(result as any).includes(migration.migrationName)) {
        throw new Error('MIGRATION_NEEDED');
      }
    }
    return result;
  } catch (e) {
    if (isMigrationNeededError(e)) {
      await applyMigrations({
        prismaClient: options.prismaClient,
        migrationFiles: options.migrationFiles,
        artificialDelayInSeconds: options.artificialDelayInSeconds,
      });
      return await options.fn();
    } else {
      throw e;
    }
  }
}
