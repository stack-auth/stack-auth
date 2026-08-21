import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const rows = await sql`
    SELECT
      i.indisvalid,
      i.indisready,
      i.indisunique,
      pg_index_column_has_property(idx.oid, 2, 'desc') AS second_column_descending,
      (
        SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attribute_number, ordinality)
        JOIN pg_attribute attribute
          ON attribute.attrelid = i.indrelid
          AND attribute.attnum = key.attribute_number
        WHERE key.ordinality <= i.indnkeyatts
      ) AS key_columns
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = idx.relnamespace
    WHERE namespace.nspname = current_schema()
      AND idx.relname = 'TvEventOccurrence_occurred_lookup_idx'
  `;
  expect(rows).toEqual([expect.objectContaining({
    indisvalid: true,
    indisready: true,
    indisunique: false,
    second_column_descending: true,
    key_columns: ["tenancyId", "occurredAt", "id"],
  })]);
};
