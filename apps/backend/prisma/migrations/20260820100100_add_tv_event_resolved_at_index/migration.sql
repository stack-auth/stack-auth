-- Keep the 24-hour TV recovery lookup bounded. This is deliberately separate
-- from the occurred-at build so each index receives its own migration budget.
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname = 'TvEventOccurrence_resolved_lookup_idx'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_am access_method ON access_method.oid = idx.relam
    WHERE n.nspname = current_schema()
      AND idx.relname = 'TvEventOccurrence_resolved_lookup_idx'
      AND tbl.relname = 'TvEventOccurrence'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnatts = i.indnkeyatts
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND access_method.amname = 'btree'
      AND (
        SELECT array_agg(table_attribute.attname::text ORDER BY index_key.ordinality)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY
          AS index_key(attribute_number, ordinality)
        JOIN pg_attribute table_attribute
          ON table_attribute.attrelid = i.indrelid
          AND table_attribute.attnum = index_key.attribute_number
        WHERE index_key.ordinality <= i.indnkeyatts
      ) = ARRAY['tenancyId', 'resolvedAt', 'id']
      AND pg_index_column_has_property(idx.oid, 1, 'desc') IS FALSE
      AND pg_index_column_has_property(idx.oid, 2, 'desc') IS TRUE
      AND pg_index_column_has_property(idx.oid, 3, 'desc') IS FALSE
  ) THEN
    RAISE EXCEPTION 'TV event resolved-at index exists with an unexpected or invalid definition';
  END IF;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TvEventOccurrence_resolved_lookup_idx"
  ON /* SCHEMA_NAME_SENTINEL */."TvEventOccurrence"("tenancyId", "resolvedAt" DESC, "id");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN pg_am access_method ON access_method.oid = idx.relam
    WHERE n.nspname = current_schema()
      AND idx.relname = 'TvEventOccurrence_resolved_lookup_idx'
      AND tbl.relname = 'TvEventOccurrence'
      AND i.indisvalid AND i.indisready AND NOT i.indisunique
      AND i.indnatts = i.indnkeyatts
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND access_method.amname = 'btree'
      AND (
        SELECT array_agg(table_attribute.attname::text ORDER BY index_key.ordinality)
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY
          AS index_key(attribute_number, ordinality)
        JOIN pg_attribute table_attribute
          ON table_attribute.attrelid = i.indrelid
          AND table_attribute.attnum = index_key.attribute_number
        WHERE index_key.ordinality <= i.indnkeyatts
      ) = ARRAY['tenancyId', 'resolvedAt', 'id']
      AND pg_index_column_has_property(idx.oid, 1, 'desc') IS FALSE
      AND pg_index_column_has_property(idx.oid, 2, 'desc') IS TRUE
      AND pg_index_column_has_property(idx.oid, 3, 'desc') IS FALSE
  ) THEN
    RAISE EXCEPTION 'TV event resolved-at index did not finish with the expected definition';
  END IF;
END
$$;
