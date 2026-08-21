-- Collected purchase revenue receives an independent concurrent build budget.
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'OneTimePurchase_purchasePage_paidAt_idx')
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace JOIN pg_am access_method ON access_method.oid = idx.relam
      WHERE n.nspname = current_schema() AND idx.relname = 'OneTimePurchase_purchasePage_paidAt_idx' AND tbl.relname = 'OneTimePurchase'
        AND i.indisvalid AND i.indisready AND NOT i.indisunique
        AND access_method.amname = 'btree'
        AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "paidAt") WHERE%'
        AND regexp_replace(
          regexp_replace(pg_get_expr(i.indpred, i.indrelid), '"[^"]+"\."PurchaseCreationSource"', '"PurchaseCreationSource"', 'g'),
          '[()\s]', '', 'g'
        ) = regexp_replace('"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NOT NULL', '[()\s]', '', 'g')
    ) THEN RAISE EXCEPTION 'TV purchase paid-at index exists with an unexpected or invalid definition'; END IF;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "OneTimePurchase_purchasePage_paidAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."OneTimePurchase"("tenancyId", "paidAt")
  WHERE "creationSource" = 'PURCHASE_PAGE'::/* SCHEMA_NAME_SENTINEL */."PurchaseCreationSource"
    AND "paidAt" IS NOT NULL;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace JOIN pg_am access_method ON access_method.oid = idx.relam
    WHERE n.nspname = current_schema() AND idx.relname = 'OneTimePurchase_purchasePage_paidAt_idx' AND tbl.relname = 'OneTimePurchase'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND access_method.amname = 'btree'
      AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "paidAt") WHERE%'
      AND regexp_replace(
        regexp_replace(pg_get_expr(i.indpred, i.indrelid), '"[^"]+"\."PurchaseCreationSource"', '"PurchaseCreationSource"', 'g'),
        '[()\s]', '', 'g'
      ) = regexp_replace('"creationSource" = ''PURCHASE_PAGE''::"PurchaseCreationSource" AND "paidAt" IS NOT NULL', '[()\s]', '', 'g')
  ) THEN RAISE EXCEPTION 'TV purchase paid-at index did not finish with the expected definition'; END IF;
END
$$;
