-- Swap the per-(tenancy, service) hostname constraint for a per-tenancy one, now that the
-- previous migration has committed proof that no duplicate (tenancyId, hostname) rows exist.
--
-- Deliberately NOT built with CONCURRENTLY. Concurrent index builds cannot run inside the
-- migration runner's wrapper transaction, and the sentinel that lifts a whole migration out
-- of that transaction is new in this change — the currently deployed backend is what applies
-- these migrations (the database is migrated before the code rolls out), and its runner does
-- not recognize it. It would fall back to issuing the build on a second pooled connection
-- while the wrapper transaction is still open, and CREATE UNIQUE INDEX CONCURRENTLY waits for
-- every older snapshot before its validation pass — including that transaction's. The two
-- then wait on each other until the statement timeout fires and the migration dies.
--
-- A plain build takes a brief ACCESS EXCLUSIVE lock instead. That is the right trade here:
-- DeploymentServiceDomain only ever holds custom domains attached to deployment services, an
-- alpha-gated feature with no meaningful row count, so the lock is momentary.
CREATE UNIQUE INDEX IF NOT EXISTS "DeploymentServiceDomain_tenancyId_hostname_key"
ON /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain"("tenancyId", "hostname");

-- The superseded per-service constraint, and the ordered access path the duplicate
-- validation in the previous migration needed. The new unique index covers both.
DROP INDEX IF EXISTS /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain_tenancyId_deploymentServiceId_hostn_key";

DROP INDEX IF EXISTS /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain_tenancy_hostname_validation_idx";
