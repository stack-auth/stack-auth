-- These indexes keep TV payment reads proportional to the requested reporting
-- window. Validate an existing name before IF NOT EXISTS can accept it, since a
-- failed concurrent build may leave an invalid index behind.
-- SINGLE_STATEMENT_SENTINEL
DO $$
DECLARE
  expected RECORD;
  existing RECORD;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      (
        'SubscriptionInvoice_tenancyId_paidAt_idx',
        'SubscriptionInvoice',
        ARRAY['tenancyId', 'paidAt'],
        '"paidAt" IS NOT NULL'
      ),
      (
        'SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx',
        'SubscriptionInvoice',
        ARRAY['tenancyId', 'markedUncollectibleAt'],
        '"markedUncollectibleAt" IS NOT NULL'
      ),
      (
        'OneTimePurchase_purchasePage_paidAt_idx',
        'OneTimePurchase',
        ARRAY['tenancyId', 'paidAt'],
        '"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NOT NULL'
      ),
      (
        'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx',
        'OneTimePurchase',
        ARRAY['tenancyId', 'createdAt'],
        '"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NULL'
      )
    ) AS expected_indexes(index_name, table_name, key_columns, predicate)
  LOOP
    SELECT
      table_relation.relname AS table_name,
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indisunique,
      access_method.amname AS access_method,
      (
        SELECT array_agg(table_attribute.attname::text ORDER BY index_key.ordinality)
        FROM unnest(index_metadata.indkey::smallint[]) WITH ORDINALITY
          AS index_key(attribute_number, ordinality)
        JOIN pg_attribute table_attribute
          ON table_attribute.attrelid = index_metadata.indrelid
          AND table_attribute.attnum = index_key.attribute_number
        WHERE index_key.ordinality <= index_metadata.indnkeyatts
      ) AS key_columns,
      regexp_replace(
        pg_get_expr(index_metadata.indpred, index_metadata.indrelid),
        '[()]',
        '',
        'g'
      ) AS predicate
    INTO existing
    FROM pg_class index_relation
    JOIN pg_namespace index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    LEFT JOIN pg_index index_metadata
      ON index_metadata.indexrelid = index_relation.oid
    LEFT JOIN pg_class table_relation
      ON table_relation.oid = index_metadata.indrelid
    LEFT JOIN pg_am access_method
      ON access_method.oid = index_relation.relam
    WHERE index_namespace.nspname = current_schema()
      AND index_relation.relname = expected.index_name;

    IF FOUND AND (
      existing.table_name IS DISTINCT FROM expected.table_name
      OR existing.indisvalid IS DISTINCT FROM TRUE
      OR existing.indisready IS DISTINCT FROM TRUE
      OR existing.indisunique IS DISTINCT FROM FALSE
      OR existing.access_method IS DISTINCT FROM 'btree'
      OR existing.key_columns IS DISTINCT FROM expected.key_columns
      OR existing.predicate IS DISTINCT FROM expected.predicate
    ) THEN
      RAISE EXCEPTION
        'TV payment index % already exists but is invalid or has an unexpected definition; drop it concurrently and retry',
        expected.index_name;
    END IF;
  END LOOP;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SubscriptionInvoice_tenancyId_paidAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."SubscriptionInvoice"("tenancyId", "paidAt")
  WHERE "paidAt" IS NOT NULL;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."SubscriptionInvoice"("tenancyId", "markedUncollectibleAt")
  WHERE "markedUncollectibleAt" IS NOT NULL;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OneTimePurchase_purchasePage_paidAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."OneTimePurchase"("tenancyId", "paidAt")
  WHERE "creationSource" = 'PURCHASE_PAGE'::"PurchaseCreationSource"
    AND "paidAt" IS NOT NULL;

-- SPLIT_STATEMENT_SENTINEL
-- This rollout index is intentionally temporary. Remove it with the legacy
-- product-snapshot fallback after all pre-normalization purchases age out.
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_OneTimePurchase_legacyPurchasePage_createdAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."OneTimePurchase"("tenancyId", "createdAt")
  WHERE "creationSource" = 'PURCHASE_PAGE'::"PurchaseCreationSource"
    AND "paidAt" IS NULL;

-- SPLIT_STATEMENT_SENTINEL
-- Record completion only after every concurrent build is valid and ready.
-- SINGLE_STATEMENT_SENTINEL
DO $$
DECLARE
  expected RECORD;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('SubscriptionInvoice_tenancyId_paidAt_idx', 'SubscriptionInvoice'),
      ('SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx', 'SubscriptionInvoice'),
      ('OneTimePurchase_purchasePage_paidAt_idx', 'OneTimePurchase'),
      ('temp_OneTimePurchase_legacyPurchasePage_createdAt_idx', 'OneTimePurchase')
    ) AS expected_indexes(index_name, table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_index index_metadata
      JOIN pg_class index_relation ON index_relation.oid = index_metadata.indexrelid
      JOIN pg_namespace index_namespace ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_class table_relation ON table_relation.oid = index_metadata.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
      WHERE index_namespace.nspname = current_schema()
        AND table_namespace.nspname = current_schema()
        AND index_relation.relname = expected.index_name
        AND table_relation.relname = expected.table_name
        AND index_metadata.indisvalid
        AND index_metadata.indisready
        AND NOT index_metadata.indisunique
        AND index_metadata.indpred IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'TV payment index % did not finish with the expected valid partial definition',
        expected.index_name;
    END IF;
  END LOOP;
END
$$;
