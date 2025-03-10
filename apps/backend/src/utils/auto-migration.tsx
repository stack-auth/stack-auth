import { prismaClient } from '@/prisma-client';
import { Prisma } from '@prisma/client';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { stringCompare } from '@stackframe/stack-shared/dist/utils/strings';
import fs from 'fs';
import path from 'path';

export let MIGRATION_FILES = getMigrationFiles();

// there are 64 migrations already applied with prisma migration tooling before we started using auto-migration
export const PRISMA_APPLIED_MIGRATIONS = MIGRATION_FILES.map(m => m.name).slice(0, 64);

const ALL_ERRORS = ['MIGRATION_IN_PROGRESS', 'MIGRATION_ALREADY_DONE', 'MIGRATION_TIMEOUT', 'MIGRATION_NEEDED'] as const;
type MigrationError = typeof ALL_ERRORS[number];

export function refreshMigrationFiles() {
  MIGRATION_FILES = getMigrationFiles();
}

function getMigrationFiles(): Array<{ name: string, sql: string }> {
  const migrationsDir = path.join(process.cwd(),  'prisma', 'migrations');
  const folders = fs.readdirSync(migrationsDir).filter(folder =>
    fs.statSync(path.join(migrationsDir, folder)).isDirectory()
  );

  const result: Array<{ name: string, sql: string }> = [];

  for (const folder of folders) {
    const folderPath = path.join(migrationsDir, folder);
    const sqlFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.sql'));

    for (const sqlFile of sqlFiles) {
      const sqlContent = fs.readFileSync(path.join(folderPath, sqlFile), 'utf8');
      result.push({
        name: folder,
        sql: sqlContent
      });
    }
  }

  result.sort((a, b) => stringCompare(a.name, b.name));

  return result;
}

function getMigrationError(error: unknown): MigrationError {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === 'P0001') {
    const errorName = (error.meta as { message: string }).message.split(' ')[1];
    if (ALL_ERRORS.includes(errorName as MigrationError)) {
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

function checkIfHasPendingMigrations() {
  return prismaClient.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 
        FROM "SchemaMigration"
        WHERE "finishedAt" IS NULL
        AND "startedAt" > clock_timestamp() - INTERVAL '10 seconds'
      ) THEN
        RAISE EXCEPTION 'MIGRATION_IN_PROGRESS';
      END IF;
    END
    $$;
  `);
}

export function createSchemaMigrationTable() {
  return prismaClient.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SchemaMigration" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
      "startedAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
      "finishedAt" TIMESTAMP(3),
      "migrationName" TEXT NOT NULL UNIQUE,
      
      CONSTRAINT "SchemaMigration_pkey" PRIMARY KEY ("id")
    );
  `);
}

async function getAppliedMigrations(appliedMigrationsIfNoMigrationTable: Array<string>) {
  const [_1, _2, _3, appliedMigrations] = await retryIfMigrationInProgress(
    async () => await prismaClient.$transaction([
      createSchemaMigrationTable(),
      prismaClient.$executeRawUnsafe(appliedMigrationsIfNoMigrationTable.length > 0 ? `
        INSERT INTO "SchemaMigration" ("migrationName", "startedAt", "finishedAt")
        SELECT 
          unnest(ARRAY['${appliedMigrationsIfNoMigrationTable.join("','")}']) as "migrationName",
          clock_timestamp() as "startedAt",
          clock_timestamp() as "finishedAt"
        WHERE NOT EXISTS (SELECT 1 FROM "SchemaMigration");
      ` : ''),
      checkIfHasPendingMigrations(),
      prismaClient.$queryRawUnsafe(`
        SELECT "migrationName" FROM "SchemaMigration" 
        WHERE "finishedAt" IS NOT NULL
        ORDER BY "startedAt" ASC
      `)
    ], {
      isolationLevel: 'Serializable',
    })
  );

  return (appliedMigrations as { migrationName: string }[]).map((migration) => migration.migrationName);
}

function startMigration(migrationName: string) {
  return [
    prismaClient.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "SchemaMigration" 
          WHERE "migrationName" = '${migrationName}'
          AND "finishedAt" IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'MIGRATION_ALREADY_DONE';
        END IF;
      END
      $$;
    `),
    checkIfHasPendingMigrations(),
    prismaClient.$executeRawUnsafe(`
      INSERT INTO "SchemaMigration" ("migrationName")
      VALUES ('${migrationName}')
      ON CONFLICT ("migrationName") DO UPDATE
      SET "startedAt" = clock_timestamp()
    `),
  ];
}

function finishMigration(migrationName: string) {
  return [prismaClient.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM "SchemaMigration"
        WHERE "migrationName" = '${migrationName}'
        AND "startedAt" < clock_timestamp() - INTERVAL '10 seconds'
        AND "finishedAt" IS NULL
      ) THEN
        RAISE EXCEPTION 'MIGRATION_TIMEOUT';
      END IF;

      UPDATE "SchemaMigration"
      SET "finishedAt" = clock_timestamp()
      WHERE "migrationName" = '${migrationName}'
      AND "finishedAt" IS NULL;
    END
    $$;
  `)];
}

async function applyMigration(options: {
  migrationName: string,
  sql: string,
}) {
  console.log('Applying migration', options.migrationName);
  try {
    await retryIfMigrationInProgress(
      async () => await prismaClient.$transaction(
        startMigration(options.migrationName),
        { isolationLevel: 'Serializable' }
      )
    );

    await prismaClient.$transaction([
      ...options.sql.split('SPLIT_STATEMENT_SENTINEL')
        .map(statement => {
          if (statement.includes('SINGLE_STATEMENT_SENTINEL')) {
            return prismaClient.$executeRawUnsafe(statement);
          } else {
            return prismaClient.$executeRawUnsafe(`
              DO $$
              BEGIN
                ${statement}
              END
              $$;
            `);
          }
        }),
      ...finishMigration(options.migrationName),
    ], {
      isolationLevel: 'Serializable',
    });
  } catch (error) {
    const migrationError = getMigrationError(error);
    switch (migrationError) {
      case 'MIGRATION_ALREADY_DONE': {
        break;
      }
      case 'MIGRATION_TIMEOUT': {
        throw new Error('Migration timeout');
      }
      case 'MIGRATION_IN_PROGRESS': {
        throw new Error('The retryIfMigrationInProgress function should have already handled this');
      }
      case 'MIGRATION_NEEDED': {
        throw new Error('This should never happen');
      }
    }
  }
}

export async function applyMigrations(options: {
  // if there is no migration table, assume these migrations are already applied
  appliedMigrationsIfNoMigrationTable: Array<string>,
}) {
  const appliedMigrations = await getAppliedMigrations(options.appliedMigrationsIfNoMigrationTable);

  for (const [index, appliedMigration] of appliedMigrations.entries()) {
    if (appliedMigration !== MIGRATION_FILES[index].name) {
      throw new StackAssertionError(`Migration is applied out of order`);
    }
  }

  for (const migration of MIGRATION_FILES.slice(appliedMigrations.length)) {
    await applyMigration({
      migrationName: migration.name,
      sql: migration.sql,
    });
  }
};

export function getMigrationCheckQuery() {
  const migrationNames = MIGRATION_FILES.map(m => `'${m.name}'`).join(',');
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

export async function runQueryAndMigrateIfNeeded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const migrationError = getMigrationError(e);
    if (migrationError === 'MIGRATION_NEEDED') {
      console.log('Migrations needed, applying migrations');
      await applyMigrations({
        appliedMigrationsIfNoMigrationTable: PRISMA_APPLIED_MIGRATIONS,
      });
      return await fn();
    }
    throw e;
  }
}
