/*
  Deployments move from Vercel to Marshal (the Fly.io-backed container
  runtime). No data migration: there are no backwards-compatible deployments
  projects, and upload rows are ephemeral (cleared below so the new reference
  column can be NOT NULL).

  Warnings:

  - You are about to drop the column `buildCommand` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `framework` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `installCommand` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `outputDirectory` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `vercelProjectId` on the `DeploymentService` table. All the data in the column will be lost.
  - You are about to drop the column `vercelDeploymentId` on the `DeploymentRun` table. All the data in the column will be lost.
  - You are about to drop the column `vercelDeploymentUrl` on the `DeploymentRun` table. All the data in the column will be lost.
  - You are about to drop the column `objectKey` on the `DeploymentSourceUpload` table. All the data in the column will be lost.
*/

-- AlterTable
ALTER TABLE "DeploymentService" DROP COLUMN "buildCommand",
DROP COLUMN "framework",
DROP COLUMN "installCommand",
DROP COLUMN "outputDirectory",
DROP COLUMN "vercelProjectId",
ADD COLUMN "dockerfilePath" TEXT,
ADD COLUMN "maxInstances" INTEGER,
ADD COLUMN "minInstances" INTEGER,
-- The ports the container listens on, as a JSON array of
-- `{ port, public, transport }`. There is deliberately no service-level
-- visibility column: a service is public exactly when one of its ports is, so
-- the two can never drift apart. `transport` sits on the port for the same
-- reason — a container speaking HTTP on one port and raw TCP on another is a
-- normal thing to want, and a service-level protocol cannot express it.
--
-- `[]` on rows that predate a synced definition: displayable, not deployable.
ADD COLUMN "ports" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "provisionedAt" TIMESTAMP(3);

-- The port rules, stated by the database because this column is the ONLY record
-- of whether a service is public.
--
-- Each rule goes through its own IMMUTABLE function: a CHECK constraint may not
-- contain a subquery, and walking a JSON array means one. Keeping them separate
-- (rather than one big validator) is what keeps the violated constraint's NAME a
-- useful diagnostic.
--
-- Every function returns the PASSING value for a non-array input, so that "ports
-- is not an array" is reported by the single constraint that says so. Postgres
-- evaluates a row's CHECK constraints in no particular order, and
-- jsonb_array_elements on a non-array raises a hard error rather than returning
-- false — without the guard, a scalar would surface as "cannot extract elements
-- from a scalar" instead of a named violation.
CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_entries_valid"(ports jsonb) RETURNS boolean AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'array' THEN true ELSE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(ports) AS entry
    -- IS DISTINCT FROM, not <>: jsonb_typeof of an ABSENT key is NULL, and
    -- `NULL <> 'number'` is NULL rather than true, which would let an entry
    -- missing the key through the filter entirely.
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR jsonb_typeof(entry -> 'port') IS DISTINCT FROM 'number'
      -- Ports are whole numbers: the ->> text of 3000.5 fails this, where a
      -- cast to int would silently round it.
      OR (entry ->> 'port') !~ '^[0-9]+$'
      -- ::numeric, not ::bigint. The regex above is unbounded, so a 20-digit
      -- port passes it and then OVERFLOWS a bigint — raising a raw Postgres
      -- error instead of the named constraint violation this whole design
      -- exists to produce. jsonb numbers are arbitrary-precision numerics, so
      -- this cast cannot overflow.
      OR (entry ->> 'port')::numeric < 1
      OR (entry ->> 'port')::numeric > 65535
      OR jsonb_typeof(entry -> 'public') IS DISTINCT FROM 'boolean'
      -- Spelled out rather than NOT IN, which yields NULL (not true) for a
      -- missing transport and would let the entry through.
      OR (entry ->> 'transport') IS NULL
      OR (entry ->> 'transport') NOT IN ('http', 'tcp')
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

-- Compares against the jsonb `true` rather than casting ->> to boolean: a
-- non-boolean `public` (say the string "maybe") makes that cast raise a raw
-- error, and the string "true" would be silently accepted as public — reporting
-- the wrong constraint for what is really a bad ENTRY. Deferring to
-- entries_valid keeps the diagnostic on the right rule.
CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_public_count"(ports jsonb) RETURNS bigint AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'array' OR NOT "hexclave_deployment_ports_entries_valid"(ports) THEN 0 ELSE (
    SELECT count(*)
    FROM jsonb_array_elements(ports) AS entry
    WHERE entry -> 'public' = 'true'::jsonb
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_public_is_http"(ports jsonb) RETURNS boolean AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'array' OR NOT "hexclave_deployment_ports_entries_valid"(ports) THEN true ELSE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(ports) AS entry
    WHERE entry -> 'public' = 'true'::jsonb AND (entry ->> 'transport') <> 'http'
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

-- Defers to the entries check for anything malformed, so an entry with no port
-- at all is reported as a bad ENTRY rather than as a duplicate (constraints are
-- evaluated in no particular order, and a missing port would otherwise collapse
-- the distinct count).
CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_are_distinct"(ports jsonb) RETURNS boolean AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'array' OR NOT "hexclave_deployment_ports_entries_valid"(ports) THEN true ELSE (
    SELECT count(DISTINCT entry ->> 'port') = jsonb_array_length(ports)
    FROM jsonb_array_elements(ports) AS entry
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_ports_is_array_check"
CHECK (jsonb_typeof("ports") = 'array');

-- Each entry is an object with an integer port in range, a boolean `public`,
-- and a known transport. Holds vacuously for the empty array.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_ports_entries_check"
CHECK ("hexclave_deployment_ports_entries_valid"("ports"));

-- Raw TCP gets no TLS termination and no HTTP routing, so it cannot be the
-- public one.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_public_port_is_http_check"
CHECK ("hexclave_deployment_ports_public_is_http"("ports"));

-- One entry per port number.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_ports_distinct_check"
CHECK ("hexclave_deployment_ports_are_distinct"("ports"));

-- FLY.IO PLATFORM LIMITATION: a public port may not have siblings. Fly's proxy
-- listener set is per-app rather than per-address, so once a public IP exists
-- every declared port answers on it — a "private" sibling of a public port would
-- be on the internet. (Private traffic reaches a port over Flycast, which IS
-- that proxy, so the entry cannot simply be omitted.) Stated here as well as in
-- the sync route because this column is the only record of which ports a service
-- exposes. See the `public-service-has-one-port` rule in @hexclave/shared's
-- deployments.ts for the full write-up.
--
-- This also subsumes "at most one public port": two public ports are two ports,
-- so `jsonb_array_length <= 1` already fails them. public_count is still what
-- distinguishes a lone public port from a lone private one.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_public_port_is_alone_check"
CHECK (jsonb_typeof("ports") <> 'array' OR jsonb_array_length("ports") <= 1 OR "hexclave_deployment_ports_public_count"("ports") = 0);

-- AlterTable
ALTER TABLE "DeploymentRun" DROP COLUMN "vercelDeploymentId",
DROP COLUMN "vercelDeploymentUrl",
ADD COLUMN "marshalBuildId" TEXT,
ADD COLUMN "revision" TEXT,
ADD COLUMN "serviceUrl" TEXT;

-- Upload slots are short-lived references; clearing them lets marshalUploadId
-- be NOT NULL without a default.
DELETE FROM "DeploymentSourceUpload";

-- AlterTable
ALTER TABLE "DeploymentSourceUpload" DROP COLUMN "objectKey",
ADD COLUMN "marshalUploadId" TEXT NOT NULL;
