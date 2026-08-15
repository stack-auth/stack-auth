-- The error-ingest client-report ledger: the durable record of item-level
-- ingest outcomes.
--
-- Client reports carry only category/reason/quantity metadata; event payloads
-- never cross this boundary. The idempotency key is supplied by the protocol
-- projection, so retrying an ambiguous response cannot double-count a report.
--
-- The table is new, so its indexes and foreign-key validation are O(1). The
-- Tenancy composite unique key its scope foreign key references is created
-- concurrently by 20260726000000_add_releases.


CREATE TABLE "ErrorIngestClientReport" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "protocol" VARCHAR(32) NOT NULL,
    "bucket" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotencyKey" VARCHAR(256) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorIngestClientReport_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "ErrorIngestClientReport_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 1000000000),
    CONSTRAINT "ErrorIngestClientReport_text_check" CHECK (
      length("protocol") > 0 AND length("bucket") > 0 AND length("reason") > 0 AND length("category") > 0 AND length("idempotencyKey") > 0
    )
);

CREATE UNIQUE INDEX "ErrorIngestClientReport_scope_idempotency_key"
  ON "ErrorIngestClientReport" ("tenancyId", "projectId", "branchId", "idempotencyKey", "bucket", "reason", "category");
CREATE INDEX "ErrorIngestClientReport_scope_reportedAt_idx"
  ON "ErrorIngestClientReport" ("tenancyId", "projectId", "branchId", "reportedAt" DESC, "id" DESC);

ALTER TABLE "ErrorIngestClientReport" ADD CONSTRAINT "ErrorIngestClientReport_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy" ("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrorIngestClientReport" ADD CONSTRAINT "ErrorIngestClientReport_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
