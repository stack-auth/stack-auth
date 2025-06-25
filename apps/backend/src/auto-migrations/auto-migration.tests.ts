import { PrismaClient } from "@prisma/client";
import postgres from 'postgres';
import { ExpectStatic } from "vitest";
import { applyMigrations, getMigrationCheckQuery, runQueryAndMigrateIfNeeded } from "./index";

const TEST_DB_PREFIX = 'stack_auth_test_db';

const getTestDbURL = (testDbName: string) => {
  // @ts-ignore - ImportMeta.env is provided by Vite
  const base = import.meta.env.STACK_DIRECT_DATABASE_CONNECTION_STRING.replace(/\/[^/]*$/, '');
  return {
    full: `${base}/${testDbName}`,
    base,
  };
};

const applySql = async (options: { sql: string | string[], fullDbURL: string }) => {
  const sql = postgres(options.fullDbURL);

  try {
    for (const query of Array.isArray(options.sql) ? options.sql : [options.sql]) {
      await sql.unsafe(query);
    }

  } finally {
    await sql.end();
  }
};

const setupTestDatabase = async () => {
  const randomSuffix = Math.random().toString(16).substring(2, 12);
  const testDbName = `${TEST_DB_PREFIX}_${randomSuffix}`;
  const dbURL = getTestDbURL(testDbName);
  await applySql({ sql: `CREATE DATABASE ${testDbName}`, fullDbURL: dbURL.base });

  const prismaClient = new PrismaClient({
    datasources: {
      db: {
        url: dbURL.full,
      },
    },
  });

  await prismaClient.$connect();

  return {
    prismaClient,
    testDbName,
    dbURL,
  };
};

const teardownTestDatabase = async (prismaClient: PrismaClient, testDbName: string) => {
  await prismaClient.$disconnect();
  const dbURL = getTestDbURL(testDbName);
  await applySql({
    sql: [
      `
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${testDbName}'
        AND pid <> pg_backend_pid();
      `,
      `DROP DATABASE IF EXISTS ${testDbName}`
    ],
    fullDbURL: dbURL.base
  });

  // Wait a bit to ensure connections are terminated
  await new Promise(resolve => setTimeout(resolve, 500));
};

function runTest(fn: (options: { expect: ExpectStatic, prismaClient: PrismaClient, dbURL: { full: string, base: string } }) => Promise<void>) {
  return async ({ expect }: { expect: ExpectStatic }) => {
    const { prismaClient, testDbName, dbURL } = await setupTestDatabase();
    try {
      await fn({ prismaClient, expect, dbURL });
    } finally {
      await teardownTestDatabase(prismaClient, testDbName);
    }
  };
}

const exampleMigrationFiles1 = [
  {
    migrationName: "001-create-table",
    sql: "CREATE TABLE test (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL);",
  },
  {
    migrationName: "002-update-table",
    sql: "ALTER TABLE test ADD COLUMN age INTEGER NOT NULL DEFAULT 0;",
  },
];

const examplePrismaBasedInitQueries = [
  // Settings
  `SET statement_timeout = 0`,
  `SET lock_timeout = 0`,
  `SET idle_in_transaction_session_timeout = 0`,
  `SET client_encoding = 'UTF8'`,
  `SET standard_conforming_strings = on`,
  `SELECT pg_catalog.set_config('search_path', '', false)`,
  `SET check_function_bodies = false`,
  `SET xmloption = content`,
  `SET client_min_messages = warning`,
  `SET row_security = off`,
  `ALTER SCHEMA public OWNER TO postgres`,
  `COMMENT ON SCHEMA public IS ''`,
  `SET default_tablespace = ''`,
  `SET default_table_access_method = heap`,
  `CREATE TABLE public."User" (
    id integer NOT NULL,
    name text NOT NULL
  )`,
  `ALTER TABLE public."User" OWNER TO postgres`,
  `CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
  )`,
  `ALTER TABLE public._prisma_migrations OWNER TO postgres`,
  `INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('a34e5ccf-c472-44c7-9d9c-0d4580d18ac3', '9785d85f8c5a8b3dbfbbbd8143cc7485bb48dd8bf30ca3eafd3cd2e1ba15a953', '2025-03-14 21:50:26.794721+00', '20250314215026_init', NULL, NULL, '2025-03-14 21:50:26.656161+00', 1)`,
  `INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES ('7e7f0e5b-f91b-40fa-b061-d8f2edd274ed', '6853f42ae69239976b84d058430774c8faa83488545e84162844dab84b47294d', '2025-03-14 21:50:47.761397+00', '20250314215047_name', NULL, NULL, '2025-03-14 21:50:47.624814+00', 1)`,
  `ALTER TABLE ONLY public."User" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id)`,
  `ALTER TABLE ONLY public._prisma_migrations ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id)`,
  `REVOKE USAGE ON SCHEMA public FROM PUBLIC`
];

const examplePrismaBasedMigrationFiles = [
  {
    migrationName: '20250314215026_init',
    sql: `CREATE TABLE "User" ("id" INTEGER NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id"));`,
  },
  {
    migrationName: '20250314215047_name',
    sql: `ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL;`,
  },
  {
    migrationName: '20250314215050_age',
    sql: `ALTER TABLE "User" ADD COLUMN "age" INTEGER NOT NULL DEFAULT 0;`,
  },
];


import.meta.vitest?.test("connects to DB", runTest(async ({ expect, prismaClient }) => {
  const result = await prismaClient.$executeRaw`SELECT 1`;
  expect(result).toBe(1);
}));

import.meta.vitest?.test("applies migrations", runTest(async ({ expect, prismaClient }) => {
  const { newlyAppliedMigrationNames } = await applyMigrations({ prismaClient, migrationFiles: exampleMigrationFiles1 });

  expect(newlyAppliedMigrationNames).toEqual(['001-create-table', '002-update-table']);

  await prismaClient.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`;

  const result = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe('test_value');

  const ageResult = await prismaClient.$queryRaw`SELECT age FROM test WHERE name = 'test_value'` as { age: number }[];
  expect(Array.isArray(ageResult)).toBe(true);
  expect(ageResult.length).toBe(1);
  expect(ageResult[0].age).toBe(0);
}));

import.meta.vitest?.test("first apply half of the migrations, then apply the other half", runTest(async ({ expect, prismaClient }) => {
  const { newlyAppliedMigrationNames } = await applyMigrations({ prismaClient, migrationFiles: exampleMigrationFiles1.slice(0, 1) });
  expect(newlyAppliedMigrationNames).toEqual(['001-create-table']);

  const { newlyAppliedMigrationNames: newlyAppliedMigrationNames2 } = await applyMigrations({ prismaClient, migrationFiles: exampleMigrationFiles1 });
  expect(newlyAppliedMigrationNames2).toEqual(['002-update-table']);

  await prismaClient.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`;

  const result = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe('test_value');

  const ageResult = await prismaClient.$queryRaw`SELECT age FROM test WHERE name = 'test_value'` as { age: number }[];
  expect(Array.isArray(ageResult)).toBe(true);
  expect(ageResult.length).toBe(1);
  expect(ageResult[0].age).toBe(0);
}));

import.meta.vitest?.test("applies migrations concurrently", runTest(async ({ expect, prismaClient }) => {
  const [result1, result2] = await Promise.all([
    applyMigrations({ prismaClient, migrationFiles: exampleMigrationFiles1, artificialDelayInSeconds: 1 }),
    applyMigrations({ prismaClient, migrationFiles: exampleMigrationFiles1, artificialDelayInSeconds: 1 }),
  ]);

  const l1 = result1.newlyAppliedMigrationNames.length;
  const l2 = result2.newlyAppliedMigrationNames.length;

  // One of the two migrations should be applied, but not both
  expect((l1 === 2 && l2 === 0) || (l1 === 0 && l2 === 2)).toBe(true);

  await prismaClient.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`;
  const result = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe('test_value');
}));


import.meta.vitest?.test("applies migration with a DB previously migrated with prisma", runTest(async ({ expect, prismaClient, dbURL }) => {
  await applySql({ sql: examplePrismaBasedInitQueries, fullDbURL: dbURL.full });
  const result = await applyMigrations({ prismaClient, migrationFiles: examplePrismaBasedMigrationFiles });
  expect(result.newlyAppliedMigrationNames).toEqual(['20250314215050_age']);

  // apply migrations again
  const result2 = await applyMigrations({ prismaClient, migrationFiles: examplePrismaBasedMigrationFiles });
  expect(result2.newlyAppliedMigrationNames).toEqual([]);
}));

import.meta.vitest?.test("applies migration while running a query", runTest(async ({ expect, prismaClient, dbURL }) => {
  await runQueryAndMigrateIfNeeded({
    prismaClient,
    fn: async () => await prismaClient.$transaction([
      prismaClient.$queryRaw(getMigrationCheckQuery({ migrationFiles: exampleMigrationFiles1 })),
      prismaClient.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`,
    ]),
    migrationFiles: exampleMigrationFiles1,
  });

  const result = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe('test_value');
}));

import.meta.vitest?.test("applies migration while running concurrent queries", runTest(async ({ expect, prismaClient, dbURL }) => {
  const runMigrationAndInsert = (testValue: string) => runQueryAndMigrateIfNeeded({
    prismaClient,
    fn: async () => await prismaClient.$transaction([
      prismaClient.$queryRaw(getMigrationCheckQuery({ migrationFiles: exampleMigrationFiles1 })),
      prismaClient.$executeRaw`INSERT INTO test (name) VALUES (${testValue})`,
    ]),
    migrationFiles: exampleMigrationFiles1,
    artificialDelayInSeconds: 1,
  });

  await Promise.all([
    runMigrationAndInsert('test_value1'),
    runMigrationAndInsert('test_value2'),
  ]);

  const result1 = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result1)).toBe(true);
  expect(result1.length).toBe(2);
  expect(result1.some(r => r.name === 'test_value1')).toBe(true);
  expect(result1.some(r => r.name === 'test_value2')).toBe(true);
}));

import.meta.vitest?.test("applies migration while running an interactive transaction", runTest(async ({ expect, prismaClient, dbURL }) => {
  return await prismaClient.$transaction(async (tx, ...args) => {
    await runQueryAndMigrateIfNeeded({
      prismaClient,
      fn: async () => {
        await prismaClient.$queryRaw(getMigrationCheckQuery({ migrationFiles: exampleMigrationFiles1 }));
      },
      migrationFiles: exampleMigrationFiles1,
    });

    await tx.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`;
    const result = await tx.$queryRaw`SELECT name FROM test` as { name: string }[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('test_value');
  }, {
    isolationLevel: undefined,
  });
}));

import.meta.vitest?.test("applies migration while running concurrent interactive transactions", runTest(async ({ expect, prismaClient, dbURL }) => {
  const runTransactionWithMigration = async (testValue: string) => {
    return await prismaClient.$transaction(async (tx) => {
      await runQueryAndMigrateIfNeeded({
        prismaClient,
        fn: async () => {
          await prismaClient.$queryRaw(getMigrationCheckQuery({ migrationFiles: exampleMigrationFiles1 }));
        },
        migrationFiles: exampleMigrationFiles1,
        artificialDelayInSeconds: 1,
      });

      await tx.$executeRaw`INSERT INTO test (name) VALUES (${testValue})`;
      return testValue;
    });
  };

  const results = await Promise.all([
    runTransactionWithMigration('concurrent_tx_1'),
    runTransactionWithMigration('concurrent_tx_2'),
  ]);

  expect(results).toEqual(['concurrent_tx_1', 'concurrent_tx_2']);

  const result = await prismaClient.$queryRaw`SELECT name FROM test` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(2);
  expect(result.some(r => r.name === 'concurrent_tx_1')).toBe(true);
  expect(result.some(r => r.name === 'concurrent_tx_2')).toBe(true);
}));
