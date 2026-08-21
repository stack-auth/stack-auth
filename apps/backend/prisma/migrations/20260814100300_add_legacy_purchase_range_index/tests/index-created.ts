import type { Sql } from "postgres";
import { expect } from "vitest";

export const postMigration = async (sql: Sql) => {
  const rows = await sql`
    SELECT table_relation.relname AS table_name, i.indisvalid, i.indisready, i.indisunique,
      access_method.amname AS access_method, pg_get_expr(i.indpred, i.indrelid) AS predicate,
      (SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
       FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attribute_number, ordinality)
       JOIN pg_attribute attribute ON attribute.attrelid = i.indrelid AND attribute.attnum = key.attribute_number
       WHERE key.ordinality <= i.indnkeyatts) AS key_columns
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = i.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
    JOIN pg_am access_method ON access_method.oid = idx.relam
    WHERE namespace.nspname = current_schema()
      AND idx.relname = 'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx'
  `;
  expect(rows).toEqual([expect.objectContaining({
    table_name: "OneTimePurchase", key_columns: ["tenancyId", "createdAt"],
    indisvalid: true, indisready: true, indisunique: false, access_method: "btree",
  })]);
  expect(rows[0].predicate.replace(/[()\s]/g, "")).toBe(
    '"creationSource"=\'PURCHASE_PAGE\'::"PurchaseCreationSource"AND"paidAt"ISNULL',
  );
};
