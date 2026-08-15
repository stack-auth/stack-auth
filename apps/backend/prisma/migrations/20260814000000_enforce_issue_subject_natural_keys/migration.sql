-- Make the IssueOwner/IssueSubscription natural keys actually unique.
--
-- Both tables have a CHECK constraint that forces exactly one of the
-- user/team subject columns to be NULL on EVERY row. Their natural-key unique
-- indexes include both columns, so under PostgreSQL's default NULLS-DISTINCT
-- semantics no two rows ever compared equal and the indexes rejected nothing —
-- the read-then-create mutation paths had no database conflict winner under
-- concurrency. The fix is NULLS NOT DISTINCT (PostgreSQL 15+, our minimum).
--
-- New installations already get the NULLS NOT DISTINCT shape from the original
-- add_issues migration; this compatibility branch only exists for pre-release
-- environments that applied the older version of that migration. Both tables
-- were introduced in this release cycle, so they are small there and the brief
-- in-transaction index rebuild is O(small). Fail quickly instead of waiting
-- behind live traffic if one of those environments has a busy table.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5min';

-- The DO block below must be its own single statement: the migration runner
-- wraps non-single-statement chunks in its own dollar-quoted DO envelope, and
-- a nested dollar-quote delimiter would terminate the outer quoting and break
-- parsing. (Same reason this comment spells it out instead of writing the
-- delimiter.)
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
DECLARE
  owner_nulls_not_distinct boolean;
  subscription_nulls_not_distinct boolean;
BEGIN
  SELECT i.indnullsnotdistinct INTO owner_nulls_not_distinct
  FROM pg_index i
  WHERE i.indexrelid = to_regclass('/* SCHEMA_NAME_SENTINEL */."IssueOwner_scope_natural_key"');
  IF owner_nulls_not_distinct IS NULL THEN
    RAISE EXCEPTION 'IssueOwner_scope_natural_key does not exist; 20260731000000_add_issues must have created it';
  END IF;
  IF NOT owner_nulls_not_distinct THEN
    -- The old index allowed duplicates, so dedupe before the rebuild or the
    -- unique build would fail and wedge the migration. Keep the most recently
    -- updated row (id as a deterministic tiebreak) — it carries the latest
    -- context; the app treats these rows as one logical record anyway.
    DELETE FROM "IssueOwner" loser
    USING "IssueOwner" winner
    WHERE loser."tenancyId" = winner."tenancyId"
      AND loser."projectId" = winner."projectId"
      AND loser."branchId" = winner."branchId"
      AND loser."issueId" = winner."issueId"
      AND loser."ownerType" = winner."ownerType"
      AND loser."ownerUserId" IS NOT DISTINCT FROM winner."ownerUserId"
      AND loser."ownerTeamId" IS NOT DISTINCT FROM winner."ownerTeamId"
      AND loser."source" = winner."source"
      AND (loser."updatedAt", loser."id") < (winner."updatedAt", winner."id");
    DROP INDEX "IssueOwner_scope_natural_key";
    CREATE UNIQUE INDEX "IssueOwner_scope_natural_key"
      ON "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "ownerType", "ownerUserId", "ownerTeamId", "source")
      NULLS NOT DISTINCT;
  END IF;

  SELECT i.indnullsnotdistinct INTO subscription_nulls_not_distinct
  FROM pg_index i
  WHERE i.indexrelid = to_regclass('/* SCHEMA_NAME_SENTINEL */."IssueSubscription_scope_natural_key"');
  IF subscription_nulls_not_distinct IS NULL THEN
    RAISE EXCEPTION 'IssueSubscription_scope_natural_key does not exist; 20260731000000_add_issues must have created it';
  END IF;
  IF NOT subscription_nulls_not_distinct THEN
    DELETE FROM "IssueSubscription" loser
    USING "IssueSubscription" winner
    WHERE loser."tenancyId" = winner."tenancyId"
      AND loser."projectId" = winner."projectId"
      AND loser."branchId" = winner."branchId"
      AND loser."issueId" = winner."issueId"
      AND loser."subjectType" = winner."subjectType"
      AND loser."subjectUserId" IS NOT DISTINCT FROM winner."subjectUserId"
      AND loser."subjectTeamId" IS NOT DISTINCT FROM winner."subjectTeamId"
      AND (loser."updatedAt", loser."id") < (winner."updatedAt", winner."id");
    DROP INDEX "IssueSubscription_scope_natural_key";
    CREATE UNIQUE INDEX "IssueSubscription_scope_natural_key"
      ON "IssueSubscription" ("tenancyId", "projectId", "branchId", "issueId", "subjectType", "subjectUserId", "subjectTeamId")
      NULLS NOT DISTINCT;
  END IF;
END
$$;
