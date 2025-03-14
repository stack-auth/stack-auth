import { PrismaClient } from "@prisma/client";
import postgres from 'postgres';
import { ExpectStatic } from "vitest";
import { applyMigrations } from "./db-migrations";

const TEST_DB_PREFIX = 'stack_auth_test_db';

const getTestDbURL = (testDbName: string) => {
  const base = 'postgres://postgres:PASSWORD-PLACEHOLDER--uqfEC1hmmv@localhost:5432';
  return {
    full: `${base}/${testDbName}`,
    base,
  };

};

const setupTestDatabase = async () => {
  const randomSuffix = Math.random().toString(16).substring(2, 12);
  const testDbName = `${TEST_DB_PREFIX}_${randomSuffix}`;
  const dbURL = getTestDbURL(testDbName);

  const sql = postgres(dbURL.base, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  try {
    await sql`CREATE DATABASE ${sql.unsafe(testDbName)}`;
  } finally {
    await sql.end();
  }


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
  };
};

const teardownTestDatabase = async (prismaClient: PrismaClient, testDbName: string) => {
  await prismaClient.$disconnect();
  const dbURL = getTestDbURL(testDbName);

  const sql = postgres(dbURL.full, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  try {
    await sql.end();

    const defaultSql = postgres(dbURL.base, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });

    try {
      await defaultSql`DROP DATABASE IF EXISTS ${defaultSql.unsafe(testDbName)}`;
    } finally {
      await defaultSql.end();
    }
  } finally {
    await sql.end();
  }
};

function runTest(fn: (options: { expect: ExpectStatic, prismaClient: PrismaClient }) => Promise<void>) {
  return async ({ expect }: { expect: ExpectStatic }) => {
    const { prismaClient, testDbName } = await setupTestDatabase();
    await fn({ prismaClient, expect });
    await teardownTestDatabase(prismaClient, testDbName);
  };
}


import.meta.vitest?.test("test prisma client connection", runTest(async ({ expect, prismaClient }) => {
  const result = await prismaClient.$executeRaw`SELECT 1`;
  expect(result).toBe(1);
}));

import.meta.vitest?.test("test migration", runTest(async ({ expect, prismaClient }) => {
  await applyMigrations({ prismaClient, migrationFiles: [
    {
      name: "001-create-table",
      sql: "CREATE TABLE test (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL);",
    },
    {
      name: "002-update-table",
      sql: "ALTER TABLE test ADD COLUMN age INTEGER NOT NULL DEFAULT 0;",
    },
  ] });

  await prismaClient.$executeRaw`INSERT INTO test (name) VALUES ('test_value')`;

  const result = await prismaClient.$queryRaw`SELECT name FROM test LIMIT 1` as { name: string }[];
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBe(1);
  expect(result[0].name).toBe('test_value');

  const ageResult = await prismaClient.$queryRaw`SELECT age FROM test WHERE name = 'test_value'` as { age: number }[];
  expect(Array.isArray(ageResult)).toBe(true);
  expect(ageResult.length).toBe(1);
  expect(ageResult[0].age).toBe(0);
}));

