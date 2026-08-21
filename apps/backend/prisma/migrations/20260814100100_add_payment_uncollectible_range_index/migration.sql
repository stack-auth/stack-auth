-- Authoritative failed subscription outcomes receive an independent build budget.
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx')
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
      WHERE n.nspname = current_schema() AND idx.relname = 'SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx' AND tbl.relname = 'SubscriptionInvoice'
        AND i.indisvalid AND i.indisready AND NOT i.indisunique
        AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "markedUncollectibleAt") WHERE%'
        AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()\s]', '', 'g') = regexp_replace('"markedUncollectibleAt" IS NOT NULL', '[()\s]', '', 'g')
    ) THEN RAISE EXCEPTION 'TV payment uncollectible index exists with an unexpected or invalid definition'; END IF;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx"
  ON /* SCHEMA_NAME_SENTINEL */."SubscriptionInvoice"("tenancyId", "markedUncollectibleAt")
  WHERE "markedUncollectibleAt" IS NOT NULL;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid JOIN pg_class tbl ON tbl.oid = i.indrelid JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = current_schema() AND idx.relname = 'SubscriptionInvoice_tenancyId_markedUncollectibleAt_idx' AND tbl.relname = 'SubscriptionInvoice'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND pg_get_indexdef(idx.oid) LIKE '%("tenancyId", "markedUncollectibleAt") WHERE%'
      AND regexp_replace(pg_get_expr(i.indpred, i.indrelid), '[()\s]', '', 'g') = regexp_replace('"markedUncollectibleAt" IS NOT NULL', '[()\s]', '', 'g')
  ) THEN RAISE EXCEPTION 'TV payment uncollectible index did not finish with the expected definition'; END IF;
END
$$;
