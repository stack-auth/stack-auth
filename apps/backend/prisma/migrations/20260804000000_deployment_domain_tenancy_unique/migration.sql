-- One hostname per tenancy, not per (tenancy, service).
--
-- The deployments runtime keeps exactly one claim per hostname, so two services in the same
-- project could each hold a row for the same hostname while only one of them actually owned
-- the certificate. The loser kept `verified = true` and kept advertising a URL that routed to
-- the winner, and removing the domain from either service tore down the other's certificate.

-- Give the bounded dedupe batches an ordered access path without blocking writes.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeploymentServiceDomain_tenancy_hostname_dedupe_idx"
ON /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain"("tenancyId", "hostname", "verified" DESC, "createdAt" ASC, "id" ASC);

-- Collapse duplicates in bounded batches. A verified row wins (it most likely owns the
-- runtime claim); ties keep the oldest row, then the lowest id for deterministic retries.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- CONDITIONALLY_REPEAT_MIGRATION_SENTINEL
WITH to_delete AS (
  SELECT loser."tenancyId", loser."id"
  FROM "DeploymentServiceDomain" loser
  WHERE EXISTS (
    SELECT 1
    FROM "DeploymentServiceDomain" winner
    WHERE winner."tenancyId" = loser."tenancyId"
      AND winner."hostname" = loser."hostname"
      AND (
        (winner."verified" AND NOT loser."verified")
        OR (winner."verified" = loser."verified" AND winner."createdAt" < loser."createdAt")
        OR (winner."verified" = loser."verified" AND winner."createdAt" = loser."createdAt" AND winner."id" < loser."id")
      )
  )
  LIMIT 10000
), deleted AS (
  DELETE FROM "DeploymentServiceDomain" domain
  USING to_delete
  WHERE domain."tenancyId" = to_delete."tenancyId" AND domain."id" = to_delete."id"
  RETURNING 1
)
SELECT COUNT(*) > 0 AS should_repeat_migration FROM deleted;

-- The unique-index cutover is deliberately a separate migration. This repeated transaction
-- reads/deletes the table; CREATE INDEX CONCURRENTLY would wait for that containing
-- transaction to finish, while the transaction waits for CREATE INDEX, until timeout.
