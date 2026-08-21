-- Temporary rollout compatibility is isolated so it cannot consume the budget
-- of permanent payment indexes and can be removed with the legacy read path.
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx')
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
      WHERE n.nspname = current_schema() AND idx.relname = 'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx' AND tbl.relname = 'OneTimePurchase'
        AND i.indisvalid AND i.indisready AND NOT i.indisunique
        AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "createdAt") WHERE%'
        AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()\s]', '', 'g') = regexp_replace('"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NULL', '[()\s]', '', 'g')
    ) THEN RAISE EXCEPTION 'TV legacy purchase index exists with an unexpected or invalid definition'; END IF;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "temp_OneTimePurchase_legacyPurchasePage_createdAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."OneTimePurchase"("tenancyId", "createdAt")
  WHERE "creationSource" = 'PURCHASE_PAGE'::/* SCHEMA_NAME_SENTINEL */."PurchaseCreationSource"
    AND "paidAt" IS NULL;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = current_schema() AND idx.relname = 'temp_OneTimePurchase_legacyPurchasePage_createdAt_idx' AND tbl.relname = 'OneTimePurchase'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "createdAt") WHERE%'
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()\s]', '', 'g') = regexp_replace('"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NULL', '[()\s]', '', 'g')
  ) THEN RAISE EXCEPTION 'TV legacy purchase index did not finish with the expected definition'; END IF;
END
$$;
