import { Prisma, PrismaClient } from '@prisma/client';
import { MIGRATION_FILES } from './migration-files';

const ALL_DB_ERRORS = ['MIGRATION_NEEDED', 'MIGRATION_IN_PROGRESS'] as const;
type MigrationError = typeof ALL_DB_ERRORS[number];

function getMigrationError(error: unknown): MigrationError {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === 'P0001') {
    const errorName = (error.meta as { message: string }).message.split(' ')[1];
    if (ALL_DB_ERRORS.includes(errorName as MigrationError)) {
      return errorName as MigrationError;
    }
  }
  throw error;
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
          "startedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
          "finishedAt" TIMESTAMP(3),
          "migrationName" TEXT NOT NULL UNIQUE,
          
          CONSTRAINT "SchemaMigration_pkey" PRIMARY KEY ("id")
        );
        
        IF EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = '_prisma_migrations'
        ) THEN
          INSERT INTO "SchemaMigration" ("migrationName", "startedAt", "finishedAt")
          SELECT 
            migration_name, 
            started_at, 
            finished_at
          FROM _prisma_migrations
          WHERE migration_name NOT IN (
            SELECT "migrationName" FROM "SchemaMigration"
          )
          AND finished_at IS NOT NULL;
        END IF;
      END $$;
    `,
    options.prismaClient.$queryRaw`
      SELECT "migrationName" FROM "SchemaMigration" 
      WHERE "finishedAt" IS NOT NULL
      ORDER BY "startedAt" ASC
    `,
  ]);

  return (appliedMigrations as { migrationName: string }[]).map((migration) => migration.migrationName);
}

async function acquireMigrationLock(options: {
  prismaClient: PrismaClient,
}) {
  const maxRetries = 10;
  let backOffInMs = 100;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await options.prismaClient.$queryRaw`
    DO $$
    DECLARE
      lock_exists BOOLEAN;
      started_at_value TIMESTAMP(3);
    BEGIN
      -- Check if SchemaMigrationLock table exists and has a row
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SchemaMigrationLock'
      ) INTO lock_exists;
      
      IF NOT lock_exists THEN
        -- Create the lock table and insert a row with current timestamp
        CREATE TABLE "SchemaMigrationLock" (
          "id" INTEGER PRIMARY KEY DEFAULT 1,
          "startedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT "single_row_check" CHECK (id = 1)
        );
        
        INSERT INTO "SchemaMigrationLock" ("startedAt") VALUES (clock_timestamp());
        -- Return null since the row didn't exist before
        started_at_value := NULL;
      ELSE
        -- Return the startedAt value since the row already existed
        SELECT "startedAt" FROM "SchemaMigrationLock" WHERE id = 1 INTO started_at_value;
        
        -- Check if started_at exists and is within 10 seconds
        IF started_at_value IS NOT NULL AND started_at_value >= clock_timestamp() - INTERVAL '10 seconds' THEN
          RAISE EXCEPTION 'MIGRATION_IN_PROGRESS';
        ELSIF started_at_value IS NOT NULL AND started_at_value < clock_timestamp() - INTERVAL '10 seconds' THEN
          -- Update the startedAt to current timestamp since it's older than 10 seconds and start this migration
          UPDATE "SchemaMigrationLock" SET "startedAt" = clock_timestamp() WHERE id = 1;
        END IF;
      END IF;
      
      -- Use a temporary table to return the value
      CREATE TEMP TABLE IF NOT EXISTS temp_result (started_at TIMESTAMP(3));
      DELETE FROM temp_result;
      INSERT INTO temp_result VALUES (started_at_value);
    END $$;
    `;
    } catch (e) {
      if (getMigrationError(e) === 'MIGRATION_IN_PROGRESS') {
        await new Promise(resolve => setTimeout(resolve, backOffInMs));
        backOffInMs *= 2 * (1 + Math.random());
      } else {
        throw e;
      }
    } finally {
      backOffInMs = 100;
    }
  }
}

function getRemoveMigrationLockQuery(options: {
  prismaClient: PrismaClient,
}) {
  return options.prismaClient.$executeRaw`
    DROP TABLE IF EXISTS "SchemaMigrationLock";
  `;
}


export async function applyMigrations(options: {
  prismaClient: PrismaClient,
  migrationFiles?: Array<{ migrationName: string, sql: string }>,
  artificialDelayInSeconds?: number,
}): Promise<{
  newlyAppliedMigrationNames: string[],
}> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;

  await acquireMigrationLock({ prismaClient: options.prismaClient });
  const appliedMigrationNames = await getAppliedMigrations({ prismaClient: options.prismaClient });

  const newMigrationFiles = migrationFiles.filter(x => !appliedMigrationNames.includes(x.migrationName));
  const transaction = [];

  for (const migration of newMigrationFiles) {
    transaction.push(options.prismaClient.$executeRaw`
      INSERT INTO "SchemaMigration" ("migrationName")
      VALUES (${migration.migrationName})
      ON CONFLICT ("migrationName") DO UPDATE
      SET "startedAt" = clock_timestamp()
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

    transaction.push(options.prismaClient.$executeRaw`
      UPDATE "SchemaMigration"
      SET "finishedAt" = clock_timestamp()
      WHERE "migrationName" = ${migration.migrationName}
    `);
  }

  if (options.artificialDelayInSeconds) {
    transaction.push(options.prismaClient.$executeRaw`
      SELECT pg_sleep(${options.artificialDelayInSeconds});
    `);
  }

  transaction.push(getRemoveMigrationLockQuery({ prismaClient: options.prismaClient }));

  try {
    await options.prismaClient.$transaction(transaction);
  } catch (e) {
    await getRemoveMigrationLockQuery({ prismaClient: options.prismaClient });
    throw e;
  }

  return { newlyAppliedMigrationNames: newMigrationFiles.map(x => x.migrationName) };
};

export function getMigrationCheckQuery(options?: {
  migrationFiles?: Array<{ migrationName: string, sql: string }>,
}) {
  const migrationFiles = options?.migrationFiles ?? MIGRATION_FILES;
  const migrationNames = migrationFiles.map(m => `'${m.migrationName}'`).join(',');
  return Prisma.raw(`
    DO $$ 
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'SchemaMigration'
      ) THEN
        IF EXISTS (
          SELECT 1 FROM "SchemaMigration" sm
          RIGHT JOIN (
            SELECT unnest(ARRAY[${migrationNames}]) as migrationName
          ) m ON sm."migrationName" = m.migrationName
          WHERE sm."migrationName" IS NULL OR sm."finishedAt" IS NULL
        ) THEN
          RAISE EXCEPTION 'MIGRATION_NEEDED';
        END IF;
      ELSE
        RAISE EXCEPTION 'MIGRATION_NEEDED';
      END IF;
    END $$;
  `);
}

export async function runQueryAndMigrateIfNeeded<T>(options: {
  prismaClient: PrismaClient,
  migrationFiles?: Array<{ migrationName: string, sql: string }>,
  fn: () => Promise<T>,
  artificialDelayInSeconds?: number,
}): Promise<T> {
  try {
    return await options.fn();
  } catch (e) {
    if (getMigrationError(e) === 'MIGRATION_NEEDED') {
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
