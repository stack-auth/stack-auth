import type { Sql } from "postgres";
import { expect } from "vitest";

export const preMigration = async (sql: Sql) => {
  const rows = await sql<{ event_count: string, event_ip_info_count: string }[]>`
    SELECT
      (SELECT count(*)::text FROM "Event") AS event_count,
      (SELECT count(*)::text FROM "EventIpInfo") AS event_ip_info_count
  `;
  return rows[0];
};

export const postMigration = async (
  sql: Sql,
  counts: Awaited<ReturnType<typeof preMigration>>,
) => {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('Event', 'EventIpInfo')
    ORDER BY table_name
  `;
  expect(tables).toEqual([{ table_name: "Event" }, { table_name: "EventIpInfo" }]);

  const rows = await sql<{ event_count: string, event_ip_info_count: string }[]>`
    SELECT
      (SELECT count(*)::text FROM "Event") AS event_count,
      (SELECT count(*)::text FROM "EventIpInfo") AS event_ip_info_count
  `;
  expect(rows[0]).toEqual(counts);
};
