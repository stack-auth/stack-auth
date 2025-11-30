CREATE TABLE "DeletedRow" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "tableName" TEXT NOT NULL,
    "sequenceId" BIGINT,
    "primaryKey" JSONB NOT NULL,
    "data" JSONB,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "DeletedRow_pkey" PRIMARY KEY ("id")
);


CREATE UNIQUE INDEX "DeletedRow_sequenceId_key" ON "DeletedRow"("sequenceId");

CREATE INDEX "DeletedRow_tableName_idx" ON "DeletedRow"("tableName");

CREATE INDEX "DeletedRow_tenancyId_idx" ON "DeletedRow"("tenancyId");


