-- Rewrite legacy `include-by-default` price sentinel in historical product JSON
-- snapshots to an empty price map, and coalesce any missing `includedItems` to
-- an empty record so downstream readers (e.g. mapProductSnapshotToInlineProduct)
-- don't throw on legacy snapshots. Include-by-default was deprecated in the
-- bulldozer payments rework and is no longer supported.
--
-- Scale note: prod has ~5 products affected at the time of writing, so a
-- single-statement UPDATE inside Prisma's default migration transaction is fine.
-- If this ever needs to run against a larger affected row set, batch it or
-- split the migration so it runs outside a transaction.

UPDATE "Subscription"
SET "product" = jsonb_set(
  jsonb_set("product"::jsonb, '{prices}', '{}'::jsonb),
  '{includedItems}',
  COALESCE("product"::jsonb->'includedItems', '{}'::jsonb)
)::json
WHERE "product"->>'prices' = 'include-by-default';

UPDATE "OneTimePurchase"
SET "product" = jsonb_set(
  jsonb_set("product"::jsonb, '{prices}', '{}'::jsonb),
  '{includedItems}',
  COALESCE("product"::jsonb->'includedItems', '{}'::jsonb)
)::json
WHERE "product"->>'prices' = 'include-by-default';

UPDATE "ProductVersion"
SET "productJson" = jsonb_set(
  jsonb_set("productJson"::jsonb, '{prices}', '{}'::jsonb),
  '{includedItems}',
  COALESCE("productJson"::jsonb->'includedItems', '{}'::jsonb)
)::json
WHERE "productJson"->>'prices' = 'include-by-default';
