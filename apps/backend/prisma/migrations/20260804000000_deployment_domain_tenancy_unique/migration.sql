-- One hostname per tenancy, not per (tenancy, service).
--
-- The deployments runtime keeps exactly one claim per hostname, so two services in the same
-- project could each hold a row for the same hostname while only one of them actually owned
-- the certificate. The loser kept `verified = true` and kept advertising a URL that routed to
-- the winner, and removing the domain from either service tore down the other's certificate.

-- Collapse any pre-existing duplicates first — the new index cannot be created otherwise.
-- Keeps the verified row if there is one (that service is the runtime's actual claim holder),
-- else the oldest, and drops the rest.
DELETE FROM "DeploymentServiceDomain"
WHERE ("tenancyId", "id") IN (
  SELECT "tenancyId", "id"
  FROM (
    SELECT
      "tenancyId",
      "id",
      row_number() OVER (
        PARTITION BY "tenancyId", "hostname"
        ORDER BY "verified" DESC, "createdAt" ASC, "id" ASC
      ) AS rn
    FROM "DeploymentServiceDomain"
  ) ranked
  WHERE rn > 1
);

-- DropIndex
DROP INDEX "DeploymentServiceDomain_tenancyId_deploymentServiceId_hostn_key";

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentServiceDomain_tenancyId_hostname_key" ON "DeploymentServiceDomain"("tenancyId", "hostname");
