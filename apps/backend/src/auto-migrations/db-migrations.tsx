import { Prisma, PrismaClient } from '@prisma/client';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { MIGRATION_FILES } from './migration-files';

const ADVISORY_LOCK_ID = 320347;

const ALL_DB_ERRORS = ['MIGRATION_IN_PROGRESS', 'MIGRATION_ALREADY_DONE', 'MIGRATION_TIMEOUT', 'MIGRATION_NEEDED'] as const;
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

async function retryIfMigrationInProgress(fn: () => Promise<any>) {
  let attempts = 0;
  const maxAttempts = 5;
  const baseDelay = 100;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const migrationError = getMigrationError(error);
      if (migrationError === 'MIGRATION_IN_PROGRESS') {
        console.log('Migration in progress, retrying...');
        if (attempts >= maxAttempts) {
          throw new StackAssertionError(`Retried ${attempts} times, but still failed migration`);
        }
        attempts++;
        const jitter = Math.random() + 1;
        const delay = (Math.pow(2, attempts) * baseDelay) * jitter;

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

async function getAppliedMigrations(options: {
  prismaClient: PrismaClient,
}) {
  const [_1, _2, _3, appliedMigrations] = await retryIfMigrationInProgress(
    async () => await options.prismaClient.$transaction([
      options.prismaClient.$executeRawUnsafe(
        `SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`
      ),
      options.prismaClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SchemaMigration" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
          "startedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
          "finishedAt" TIMESTAMP(3),
          "migrationName" TEXT NOT NULL UNIQUE,
          
          CONSTRAINT "SchemaMigration_pkey" PRIMARY KEY ("id")
        );
      `),
      options.prismaClient.$executeRawUnsafe(`
        DO $$
        BEGIN
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
      `),
      options.prismaClient.$queryRawUnsafe(`
        SELECT "migrationName" FROM "SchemaMigration" 
        WHERE "finishedAt" IS NOT NULL
        ORDER BY "startedAt" ASC
      `),
      options.prismaClient.$executeRawUnsafe(`
        SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID});
      `),
    ], {
      isolationLevel: 'Serializable',
    })
  );

  return (appliedMigrations as { migrationName: string }[]).map((migration) => migration.migrationName);
}


export async function applyMigrations(options: {
  prismaClient: PrismaClient,
  migrationFiles?: Array<{ migrationName: string, sql: string }>,
  artificialDelaySecond?: number,
}): Promise<{
  newlyAppliedMigrationNames: string[],
}> {
  const migrationFiles = options.migrationFiles ?? MIGRATION_FILES;

  const appliedMigrations = await getAppliedMigrations({
    prismaClient: options.prismaClient,
  });

  for (const [index, appliedMigration] of appliedMigrations.entries()) {
    if (appliedMigration !== migrationFiles[index].migrationName) {
      throw new StackAssertionError(`Migration is applied out of order`);
    }
  }

  const transactions = [];
  const newMigrationFiles = migrationFiles.slice(appliedMigrations.length);

  for (const migration of migrationFiles.slice(appliedMigrations.length)) {
    transactions.push(options.prismaClient.$executeRawUnsafe(`
      INSERT INTO "SchemaMigration" ("migrationName")
      VALUES ('${migration.migrationName}')
      ON CONFLICT ("migrationName") DO UPDATE
      SET "startedAt" = clock_timestamp()
    `));

    transactions.push(...migration.sql.split('SPLIT_STATEMENT_SENTINEL')
      .map(statement => {
        if (statement.includes('SINGLE_STATEMENT_SENTINEL')) {
          return options.prismaClient.$executeRawUnsafe(statement);
        } else {
          return options.prismaClient.$executeRawUnsafe(`
            DO $$
            BEGIN
              ${statement}
            END
            $$;
          `);
        }
      })
    );

    transactions.push(options.prismaClient.$executeRawUnsafe(`
      UPDATE "SchemaMigration"
      SET "finishedAt" = clock_timestamp()
      WHERE "migrationName" = '${migration.migrationName}'
    `));
  }

  if (options.artificialDelaySecond) {
    transactions.push(options.prismaClient.$executeRawUnsafe(`
      SELECT pg_sleep(${options.artificialDelaySecond});
    `));
  }

  try {
    await options.prismaClient.$transaction(transactions, {
      isolationLevel: 'Serializable',
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '40001') {
      console.log('Multiple migrations running at the same time. Skipping this one');
      return {
        newlyAppliedMigrationNames: []
      };
    } else {
      throw error;
    }
  }

  return {
    newlyAppliedMigrationNames: newMigrationFiles.map(x => x.migrationName)
  };
};

export function getMigrationCheckQuery() {
  const migrationNames = MIGRATION_FILES.map(m => `'${m.migrationName}'`).join(',');
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
  fn: () => Promise<T>,
}): Promise<T> {
  try {
    return await options.fn();
  } catch (e) {
    const migrationError = getMigrationError(e);
    if (migrationError === 'MIGRATION_NEEDED') {
      console.log('Migrations needed, applying migrations');
      await applyMigrations({
        prismaClient: options.prismaClient,
      });
      return await options.fn();
    }
    throw e;
  }
}
