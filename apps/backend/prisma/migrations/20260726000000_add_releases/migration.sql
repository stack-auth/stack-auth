-- Release graph: releases, deployments, commits and uploaded artifacts.
--
-- Release rows carry the complete tenancy scope rather than just a tenancyId.
-- Tenancy is the authoritative project/branch scope, and the composite foreign
-- key below makes it impossible for a release row to pair a tenancy with a
-- different project or branch. The child graph repeats the same scope so every
-- release query stays tenant- and branch-indexed without loading the parent.
--
-- All tables here are new, so their indexes and foreign-key validation are
-- O(1). The one non-O(1) step is the Tenancy composite unique index that the
-- new scope foreign keys reference: Tenancy is a hot, high-cardinality table,
-- so it is built concurrently outside the bookkeeping transaction rather than
-- taking an ACCESS EXCLUSIVE lock. Later observability migrations reuse this
-- same key for their own scope foreign keys, so it lands here rather than
-- being repeated.

-- The FK adds below take brief SHARE ROW EXCLUSIVE locks on hot referenced
-- tables (Tenancy, Project). Fail fast instead of queueing an exclusive lock
-- request behind long-running production queries. SET LOCAL is
-- transaction-scoped, so this covers every in-transaction chunk of this file.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5min';

-- If a previous attempt's CREATE INDEX CONCURRENTLY crashed mid-build, it
-- leaves an INVALID index behind. IF NOT EXISTS would then skip the rebuild,
-- and the composite foreign keys below would fail with "no unique constraint
-- matching given keys" on every retry, with no way to make progress without
-- manual intervention. Drop such a leftover so the retry rebuilds it. The DROP
-- takes a brief ACCESS EXCLUSIVE lock on Tenancy, but only in the
-- crashed-previous-attempt case; the happy path takes no lock at all.
-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
DO $$
DECLARE
  invalid_index_oid oid;
BEGIN
  SELECT i.indexrelid INTO invalid_index_oid
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = '/* SCHEMA_NAME_SENTINEL */."Tenancy"'::regclass
    AND c.relname = 'Tenancy_id_projectId_branchId_key'
    AND NOT i.indisvalid;
  IF invalid_index_oid IS NOT NULL THEN
    EXECUTE 'DROP INDEX ' || invalid_index_oid::regclass;
  END IF;
END
$$;

-- SPLIT_STATEMENT_SENTINEL
-- SINGLE_STATEMENT_SENTINEL
-- RUN_OUTSIDE_TRANSACTION_SENTINEL
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Tenancy_id_projectId_branchId_key"
  ON /* SCHEMA_NAME_SENTINEL */."Tenancy" ("id", "projectId", "branchId");

-- SPLIT_STATEMENT_SENTINEL

CREATE TYPE "ReleaseStatus" AS ENUM ('OPEN', 'ARCHIVED');
CREATE TYPE "ReleaseArtifactStatus" AS ENUM ('REGISTERED', 'FINALIZED');

CREATE TABLE "Release" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" VARCHAR(250) NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'OPEN',
    "ref" VARCHAR(250),
    "url" TEXT,
    "data" JSONB,
    "dateAdded" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateStarted" TIMESTAMP(3),
    "dateReleased" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("tenancyId", "id")
);

CREATE TABLE "ReleaseDeployment" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "releaseId" UUID NOT NULL,
    "deploymentKey" VARCHAR(256) NOT NULL,
    "environment" VARCHAR(255) NOT NULL,
    "name" VARCHAR(64),
    "url" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseDeployment_pkey" PRIMARY KEY ("tenancyId", "id")
);

CREATE TABLE "ReleaseCommit" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "releaseId" UUID NOT NULL,
    "repository" VARCHAR(256) NOT NULL,
    "commitSha" VARCHAR(128) NOT NULL,
    "position" INTEGER NOT NULL,
    "message" TEXT,
    "authorName" VARCHAR(256),
    "authorEmail" VARCHAR(320),
    "committedAt" TIMESTAMP(3),
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseCommit_pkey" PRIMARY KEY ("tenancyId", "id")
);

CREATE TABLE "ReleaseArtifact" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "releaseId" UUID NOT NULL,
    "manifestSha256" VARCHAR(64) NOT NULL,
    "dist" VARCHAR(64),
    "environment" VARCHAR(255),
    "status" "ReleaseArtifactStatus" NOT NULL DEFAULT 'REGISTERED',
    "manifestObjectKey" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseArtifact_pkey" PRIMARY KEY ("tenancyId", "id")
);

CREATE TABLE "ReleaseArtifactDebugId" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "releaseArtifactId" UUID NOT NULL,
    "debugId" VARCHAR(36) NOT NULL,
    "codeFile" TEXT NOT NULL,
    "sourceMapFile" TEXT,
    "sourceMapInline" BOOLEAN NOT NULL,
    "bundleSha256" VARCHAR(64) NOT NULL,
    "bundleBytes" INTEGER NOT NULL,
    "sourceMapSha256" VARCHAR(64) NOT NULL,
    "sourceMapBytes" INTEGER NOT NULL,
    "sourceMapGzippedBytes" INTEGER NOT NULL,
    "bundleObjectKey" TEXT,
    "sourceMapObjectKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseArtifactDebugId_pkey" PRIMARY KEY ("tenancyId", "id")
);

CREATE UNIQUE INDEX "Release_tenancyId_version_key" ON "Release"("tenancyId", "version");
CREATE INDEX "Release_scope_dateAdded_idx" ON "Release"("tenancyId", "projectId", "branchId", "dateAdded" DESC, "id" DESC);
CREATE INDEX "Release_tenancyId_status_dateReleased_idx" ON "Release"("tenancyId", "status", "dateReleased");
CREATE UNIQUE INDEX "ReleaseDeployment_tenancyId_deploymentKey_key" ON "ReleaseDeployment"("tenancyId", "deploymentKey");
CREATE INDEX "ReleaseDeployment_release_environment_finishedAt_idx" ON "ReleaseDeployment"("tenancyId", "releaseId", "environment", "finishedAt");
CREATE INDEX "ReleaseDeployment_environment_finishedAt_idx" ON "ReleaseDeployment"("tenancyId", "environment", "finishedAt");
CREATE UNIQUE INDEX "ReleaseCommit_release_repository_sha_key" ON "ReleaseCommit"("tenancyId", "releaseId", "repository", "commitSha");
CREATE UNIQUE INDEX "ReleaseCommit_release_position_key" ON "ReleaseCommit"("tenancyId", "releaseId", "position");
CREATE INDEX "ReleaseCommit_repository_sha_idx" ON "ReleaseCommit"("tenancyId", "repository", "commitSha");
CREATE UNIQUE INDEX "ReleaseArtifact_release_manifest_key" ON "ReleaseArtifact"("tenancyId", "releaseId", "manifestSha256");
CREATE INDEX "ReleaseArtifact_release_environment_dist_idx" ON "ReleaseArtifact"("tenancyId", "releaseId", "environment", "dist", "createdAt");
CREATE UNIQUE INDEX "ReleaseArtifactDebugId_artifact_debugId_key" ON "ReleaseArtifactDebugId"("tenancyId", "releaseArtifactId", "debugId");
CREATE INDEX "ReleaseArtifactDebugId_tenancyId_debugId_idx" ON "ReleaseArtifactDebugId"("tenancyId", "debugId");

ALTER TABLE "Release" ADD CONSTRAINT "Release_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseDeployment" ADD CONSTRAINT "ReleaseDeployment_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseDeployment" ADD CONSTRAINT "ReleaseDeployment_release_fkey"
  FOREIGN KEY ("tenancyId", "releaseId") REFERENCES "Release"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseCommit" ADD CONSTRAINT "ReleaseCommit_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseCommit" ADD CONSTRAINT "ReleaseCommit_release_fkey"
  FOREIGN KEY ("tenancyId", "releaseId") REFERENCES "Release"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseArtifact" ADD CONSTRAINT "ReleaseArtifact_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseArtifact" ADD CONSTRAINT "ReleaseArtifact_release_fkey"
  FOREIGN KEY ("tenancyId", "releaseId") REFERENCES "Release"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseArtifactDebugId" ADD CONSTRAINT "ReleaseArtifactDebugId_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseArtifactDebugId" ADD CONSTRAINT "ReleaseArtifactDebugId_artifact_fkey"
  FOREIGN KEY ("tenancyId", "releaseArtifactId") REFERENCES "ReleaseArtifact"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
