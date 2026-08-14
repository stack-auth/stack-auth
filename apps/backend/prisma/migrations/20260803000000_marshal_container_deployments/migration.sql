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
-- The ports the container listens on, as a JSON OBJECT keyed by port number:
-- `{"3000": {"public": true, "protocol": "http"}}`. The same shape the deploy
-- file writes, kept all the way through the wire and this column so nothing has
-- to translate between two spellings of one thing — and duplicate ports become
-- impossible by construction rather than by a constraint.
--
-- There is deliberately no service-level visibility column: a service is public
-- exactly when one of its ports is, so the two can never drift apart. `protocol`
-- sits on the port for the same reason — a container speaking HTTP on one port
-- and raw TCP on another is a normal thing to want, and a service-level protocol
-- cannot express it.
--
-- `{}` on rows that predate a synced definition: displayable, not deployable.
ADD COLUMN "ports" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "provisionedAt" TIMESTAMP(3);

-- The port rules, stated by the database because this column is the ONLY record
-- of whether a service is public.
--
-- Each rule goes through its own IMMUTABLE function: a CHECK constraint may not
-- contain a subquery, and walking a JSON object means one. Keeping them separate
-- (rather than one big validator) is what keeps the violated constraint's NAME a
-- useful diagnostic.
--
-- Every function returns the PASSING value for a non-object input, so that
-- "ports is not an object" is reported by the single constraint that says so.
-- Postgres evaluates a row's CHECK constraints in no particular order, and
-- jsonb_each on a scalar raises a hard error rather than returning false —
-- without the guard, a scalar would surface as "cannot deconstruct a scalar"
-- instead of a named violation.
CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_entries_valid"(ports jsonb) RETURNS boolean AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'object' THEN true ELSE NOT EXISTS (
    SELECT 1
    FROM jsonb_each(ports) AS entry(port_key, definition)
    -- The KEY is the port number, in its ONE canonical spelling: decimal, no
    -- leading zero. The spelling rule is load-bearing rather than cosmetic —
    -- "80" and "080" are different keys of one JSON object but the same port,
    -- so both would be stored and the runtime would declare two identical
    -- external listeners for it. Refusing the non-canonical spelling makes a
    -- duplicate port impossible by construction, which is the same reason this
    -- column is an object keyed by port and not an array.
    --
    -- Unbounded digits are matched first and the range compared as numeric: the
    -- regex alone would let a 20-digit key through, and a cast to bigint would
    -- then raise a raw Postgres error instead of the named constraint violation
    -- this design exists to produce.
    WHERE entry.port_key !~ '^[1-9][0-9]*$'
      OR entry.port_key::numeric < 1
      OR entry.port_key::numeric > 65535
      -- IS DISTINCT FROM, not <>: jsonb_typeof of an ABSENT key is NULL, and
      -- `NULL <> 'object'` is NULL rather than true, which would let an entry
      -- missing the key through the filter entirely.
      OR jsonb_typeof(entry.definition) IS DISTINCT FROM 'object'
      OR jsonb_typeof(entry.definition -> 'public') IS DISTINCT FROM 'boolean'
      -- Spelled out rather than NOT IN, which yields NULL (not true) for a
      -- missing protocol and would let the entry through.
      OR (entry.definition ->> 'protocol') IS NULL
      OR (entry.definition ->> 'protocol') NOT IN ('http', 'tcp')
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

-- Compares against the jsonb `true` rather than casting ->> to boolean: a
-- non-boolean `public` (say the string "maybe") makes that cast raise a raw
-- error, and the string "true" would be silently accepted as public — reporting
-- the wrong constraint for what is really a bad ENTRY. Deferring to
-- entries_valid keeps the diagnostic on the right rule.
CREATE OR REPLACE FUNCTION "hexclave_deployment_ports_public_is_http"(ports jsonb) RETURNS boolean AS $fn$
  SELECT CASE WHEN jsonb_typeof(ports) <> 'object' OR NOT "hexclave_deployment_ports_entries_valid"(ports) THEN true ELSE NOT EXISTS (
    SELECT 1
    FROM jsonb_each(ports) AS entry(port_key, definition)
    WHERE entry.definition -> 'public' = 'true'::jsonb AND (entry.definition ->> 'protocol') <> 'http'
  ) END;
$fn$ LANGUAGE sql IMMUTABLE;

ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_ports_is_object_check"
CHECK (jsonb_typeof("ports") = 'object');

-- Each key is a port number in range, and each value is an object with a boolean
-- `public` and a known protocol. Holds vacuously for the empty object.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_ports_entries_check"
CHECK ("hexclave_deployment_ports_entries_valid"("ports"));

-- Raw TCP gets no TLS termination and no HTTP routing, so it cannot be the
-- public one.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_public_port_is_http_check"
CHECK ("hexclave_deployment_ports_public_is_http"("ports"));

-- FLY.IO PLATFORM LIMITATION: a service may not mix public and private ports.
-- Fly's proxy listener set is per-app rather than per-address, so once a public
-- IP exists every declared port answers on it — a "private" sibling of a public
-- port would be on the internet. (Private traffic reaches a port over Flycast,
-- which IS that proxy, so the entry cannot simply be omitted.)
--
-- Deliberately NOT a CHECK constraint, unlike the port-shape rules above. Those
-- are about what the column may CONTAIN and stay true forever. This one is a
-- fact about the RUNTIME we deploy onto, and it is expected to move: it is a
-- shared IPv4 and an addressing model away from being lifted, and the version of
-- it that shipped first ("a public port may not have siblings") was already
-- wrong about several public ports, which leak nothing. Encoding a platform's
-- current shape as a database invariant buys an unmigratable copy of an opinion.
-- Enforced instead by the `public-and-private-ports-are-not-mixed` rule in
-- @hexclave/shared's deployments.ts, which the sync route, the CLI evaluator and
-- Marshal's validateServiceSpec all sit behind — no writer reaches this column
-- without passing it.

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
