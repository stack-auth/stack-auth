import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const constraints = await sql<{ conname: string, convalidated: boolean }[]>`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conname IN (
      'CommsMessageParticipant_contact_fkey',
      'CommsMessageParticipant_channel_fkey'
    )
    ORDER BY conname
  `;
  expect(constraints).toEqual([
    { conname: "CommsMessageParticipant_channel_fkey", convalidated: true },
    { conname: "CommsMessageParticipant_contact_fkey", convalidated: true },
  ]);
};
