-- Service types, volume ids, and the Deployment grouping entity.
--
-- Three independent additive changes that ship together because they come from
-- one config-shape change (`export const deployment = { services }`):
--
--   1. DeploymentService.type — "server" | "serverless", replacing the single
--      "container" type.
--   2. DeploymentService.volumeId — the caller-chosen volume id that now names
--      the Fly volume, making a disk's identity independent of its service.
--   3. Deployment — one row per `hexclave deploy`, grouping the per-service
--      DeploymentRuns it triggered.
--
-- All of it is nullable or defaulted, so no backfill is needed and a rollback
-- only loses the new grouping and the id/type distinction.

-- ============================ 1. service type ============================
-- The DEFAULT is only there so the NOT NULL column can be added to a table that
-- already has rows (DeploymentService predates this stack). Every writer sets
-- the column explicitly; nothing relies on the default after this migration.
ALTER TABLE "DeploymentService" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'serverless';

ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_type_check"
CHECK ("type" IN ('server', 'serverless'));

-- ============================ 2. volume id ============================
-- The volume columns themselves are unreleased (20260806000000 is in the same
-- unmerged stack) and no Fly volume exists in production, so there is no
-- id-less disk to accommodate: the id is simply part of the volume from here on.
ALTER TABLE "DeploymentService" ADD COLUMN "volumeId" TEXT;

-- The pair constraint from 20260806000000 becomes a tuple constraint over all
-- three columns. Dropped and recreated rather than added alongside, so there is
-- exactly one statement of the rule.
ALTER TABLE "DeploymentService" DROP CONSTRAINT "DeploymentService_volume_pair_check";

-- Backfill BEFORE the new constraints, which are added validating (no
-- NOT VALID/VALIDATE split) and so are checked against existing rows.
--
-- A row written under 20260806000000 has a path and a size but no id, and takes
-- 'serverless' from the default above — violating both the tuple check and the
-- volume-requires-server check, which would abort this migration and leave the
-- database with a failed migration blocking every later one. Production has no
-- such row (the volume columns are unreleased), but any branch environment that
-- deployed a service with a volume does.
--
-- The declaration is cleared rather than given an id: those disks are named
-- hexclave_data, which no code path resolves any more, so keeping the row would
-- claim a disk the runtime cannot find. The Fly volume itself is untouched and
-- must be reclaimed by hand if it holds anything worth keeping.
UPDATE "DeploymentService"
SET "volumePath" = NULL, "volumeSizeGb" = NULL
WHERE "volumeId" IS NULL AND "volumePath" IS NOT NULL;

-- All three or none. A partial row is read as "no volume"
-- (definitionFromServiceRow refuses to invent the missing part), so without this
-- a partial write would silently detach a service's disk on its next deploy
-- rather than failing loudly.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_volume_tuple_check"
CHECK (
  ("volumeId" IS NULL AND "volumePath" IS NULL AND "volumeSizeGb" IS NULL)
  OR ("volumeId" IS NOT NULL AND "volumePath" IS NOT NULL AND "volumeSizeGb" IS NOT NULL)
);

-- Mirrors DEPLOYMENT_VOLUME_ID_REGEX / MAX_VOLUME_ID_LENGTH in
-- @hexclave/shared/dist/deployments. The id becomes a Fly volume name, so a
-- hand-edited row with an id Fly would reject must fail here rather than at
-- apply time.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_volumeId_format_check"
CHECK ("volumeId" IS NULL OR "volumeId" ~ '^[a-z][a-z0-9_]{0,25}$');

-- A volume id names one disk, so two services in one tenancy may not both claim
-- it — that would ask Fly to mount one volume on two machines. The CLI and the
-- sync route both reject it; this is the backstop that makes it impossible.
CREATE UNIQUE INDEX "DeploymentService_tenancyId_volumeId_key"
ON "DeploymentService"("tenancyId", "volumeId")
WHERE "volumeId" IS NOT NULL;

-- Only a "server" may hold a disk. Enforced here too because the alternative to
-- a loud failure is a serverless fleet whose instances each get their own
-- unreplicated copy of what the tenant believes is shared storage.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_volume_requires_server_check"
CHECK ("volumePath" IS NULL OR "type" = 'server');

-- ============================ 3. deployments ============================
CREATE TABLE "Deployment" (
    "tenancyId" UUID NOT NULL,
    -- No database default: the id is generated client-side by Prisma
    -- (`@default(uuid())`), matching DeploymentRun and the rest of the schema.
    -- A database default here is drift that `prisma migrate diff` fails on.
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "number" INTEGER NOT NULL,
    "target" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "plannedServiceIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("tenancyId","id")
);

-- The user-facing "#47". Unique per tenancy so two concurrent deploys cannot
-- land on the same number — the loser's transaction fails and retries rather
-- than producing two deployments that print identically.
CREATE UNIQUE INDEX "Deployment_tenancyId_number_key" ON "Deployment"("tenancyId", "number");

CREATE INDEX "Deployment_tenancyId_createdAt_idx" ON "Deployment"("tenancyId", "createdAt" DESC);

ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_tenancyId_fkey"
FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Null on runs that predate grouping, and on runs from a direct deploy that sent no
-- deployment_id. Those runs are reachable per service (the Services tab and the runs
-- routes are keyed by service, not by deployment) but do NOT appear in the deployments
-- list, which reads Deployment rows only. Acceptable while deployments are alpha —
-- `hexclave deploy` always creates a Deployment — but it is a real gap, not a design.
ALTER TABLE "DeploymentRun" ADD COLUMN "deploymentId" UUID;

CREATE INDEX "DeploymentRun_tenancyId_deploymentId_idx" ON "DeploymentRun"("tenancyId", "deploymentId");

-- SET NULL, not CASCADE: deleting a deployment must never delete the run
-- history of services that are still live.
--
-- The column list is REQUIRED, not stylistic. This is a composite foreign key,
-- and a bare ON DELETE SET NULL nulls EVERY referencing column — including
-- "tenancyId", which is NOT NULL. That makes deleting any deployment fail with
-- `null value in column "tenancyId" ... violates not-null constraint` instead of
-- orphaning its runs. Naming "deploymentId" (Postgres 15+) nulls only the half
-- that is nullable. Verified against the local database both ways.
--
-- The NAME must be the one Prisma derives from the relation's field list
-- ("DeploymentRun" + the referencing columns + "_fkey"); anything else is drift
-- that `prisma migrate diff` fails on, since the relation itself is expressible
-- in schema.prisma and only its ON DELETE column list is not.
ALTER TABLE "DeploymentRun" ADD CONSTRAINT "DeploymentRun_tenancyId_deploymentId_fkey"
FOREIGN KEY ("tenancyId", "deploymentId") REFERENCES "Deployment"("tenancyId", "id") ON DELETE SET NULL ("deploymentId") ON UPDATE CASCADE;
