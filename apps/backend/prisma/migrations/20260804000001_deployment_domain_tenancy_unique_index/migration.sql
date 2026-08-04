-- Build the replacement constraint after duplicate validation committed, without taking a
-- long write-blocking table lock.
-- RUN_FULL_MIGRATION_OUTSIDE_TRANSACTION_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "DeploymentServiceDomain_tenancyId_hostname_key"
ON /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain"("tenancyId", "hostname");

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain_tenancyId_deploymentServiceId_hostn_key";

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
DROP INDEX CONCURRENTLY IF EXISTS /* SCHEMA_NAME_SENTINEL */."DeploymentServiceDomain_tenancy_hostname_validation_idx";
