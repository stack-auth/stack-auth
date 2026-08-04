-- One hostname per tenancy, not per (tenancy, service).
--
-- The deployments runtime keeps exactly one claim per hostname, so two services in the same
-- project could each hold a row for the same hostname while only one of them actually owned
-- the certificate. The loser kept `verified = true` and kept advertising a URL that routed to
-- the winner, and removing the domain from either service tore down the other's certificate.

-- Give the duplicate validation an ordered access path without blocking writes.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DeploymentServiceDomain_tenancy_hostname_validation_idx"
ON /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain"("tenancyId", "hostname");

-- No database field can identify the runtime's current owner: `verified` is only a cached
-- observation and multiple rows may be true. Refuse the cutover instead of deleting a
-- possibly-current owner. An operator can reconcile the runtime claim, remove the stale row,
-- and retry this migration without losing either record automatically.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "DeploymentServiceDomain"
    GROUP BY "tenancyId", "hostname"
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'DeploymentServiceDomain contains duplicate (tenancyId, hostname) rows; reconcile each hostname against Marshal before retrying';
  END IF;
END $$;

-- The unique-index cutover is deliberately a separate migration so its concurrent build is
-- not coupled to the validation transaction.
