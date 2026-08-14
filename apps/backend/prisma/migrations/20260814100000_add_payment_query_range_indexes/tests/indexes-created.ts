import type { Sql } from "postgres";
import { expect } from "vitest";

const EXPECTED_INDEXES = new Map([
  ["SubscriptionInvoice_tenancyId_paidAt_idx", {
    tableName: "SubscriptionInvoice",
    keyColumns: ["tenancyId", "paidAt"],
    predicateParts: ['"paidAt" IS NOT NULL'],
  }],
  ["SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx", {
    tableName: "SubscriptionInvoice",
    keyColumns: ["tenancyId", "markedUncollectibleAt"],
    predicateParts: ['"markedUncollectibleAt" IS NOT NULL'],
  }],
  ["OneTimePurchase_purchasePage_paidAt_idx", {
    tableName: "OneTimePurchase",
    keyColumns: ["tenancyId", "paidAt"],
    predicateParts: ['"creationSource" = \'PURCHASE_PAGE\'::"PurchaseCreationSource"', '"paidAt" IS NOT NULL'],
  }],
  ["temp_OneTimePurchase_legacyPurchasePage_createdAt_idx", {
    tableName: "OneTimePurchase",
    keyColumns: ["tenancyId", "createdAt"],
    predicateParts: ['"creationSource" = \'PURCHASE_PAGE\'::"PurchaseCreationSource"', '"paidAt" IS NULL'],
  }],
]);

export const postMigration = async (sql: Sql) => {
  const indexes = await sql`
    SELECT
      index_relation.relname AS index_name,
      table_relation.relname AS table_name,
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indisunique,
      access_method.amname AS access_method,
      pg_get_expr(index_metadata.indpred, index_metadata.indrelid) AS predicate,
      (
        SELECT array_agg(table_attribute.attname::text ORDER BY index_key.ordinality)
        FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
          AS index_key(attribute_number, ordinality)
        JOIN pg_attribute table_attribute
          ON table_attribute.attrelid = index_metadata.indrelid
          AND table_attribute.attnum = index_key.attribute_number
        WHERE index_key.ordinality <= index_metadata.indnkeyatts
      ) AS key_columns
    FROM pg_index index_metadata
    JOIN pg_class index_relation ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_am access_method ON access_method.oid = index_relation.relam
    WHERE table_namespace.nspname = current_schema()
      AND index_relation.relname IN (
        'SubscriptionInvoice_tenancyId_paidAt_idx',
        'SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx',
        'OneTimePurchase_purchasePage_paidAt_idx',
        'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx'
      )
    ORDER BY index_relation.relname
  `;

  expect(indexes).toHaveLength(EXPECTED_INDEXES.size);
  for (const index of indexes) {
    const expected = EXPECTED_INDEXES.get(index.index_name);
    expect(expected).toBeDefined();
    expect(index).toMatchObject({
      table_name: expected?.tableName,
      key_columns: expected?.keyColumns,
      indisvalid: true,
      indisready: true,
      indisunique: false,
      access_method: "btree",
    });
    for (const predicatePart of expected?.predicateParts ?? []) {
      expect(index.predicate).toContain(predicatePart);
    }
  }
};
