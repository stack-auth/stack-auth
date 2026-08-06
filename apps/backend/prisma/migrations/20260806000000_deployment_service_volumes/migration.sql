-- Persistent disks for container deployment services.
--
-- Both columns null = no volume, i.e. the entirely ephemeral container
-- filesystem every existing row already has. Nullable and additive, so no
-- backfill is needed and rolling back only loses the volume definition (the
-- underlying Fly volume is keyed by the service's app name, not by these
-- columns, so it survives independently).

-- AlterTable
ALTER TABLE "DeploymentService" ADD COLUMN     "volumePath" TEXT,
ADD COLUMN     "volumeSizeGb" INTEGER;

-- The two columns are meaningful only as a PAIR, and every writer sets or
-- clears them together. Enforce it in the database as well: a half-written row
-- is read as "no volume" (definitionFromServiceRow refuses to invent the
-- missing half), so without this constraint a partial write would silently
-- detach a service's disk on its next deploy rather than failing loudly.
--
-- Not NOT VALID / VALIDATE in two steps, unlike the GtmNote constraints: both
-- columns were created NULL in this same migration, so no existing row can
-- violate it and the validation scan is trivial.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_volume_pair_check"
CHECK (("volumePath" IS NULL) = ("volumeSizeGb" IS NULL));

-- Mirrors MIN/MAX_VOLUME_SIZE_GB in @hexclave/shared/dist/deployments. The API
-- layers validate this too; the constraint is the backstop against a
-- hand-edited row reaching Marshal with a size Fly would reject.
ALTER TABLE "DeploymentService"
ADD CONSTRAINT "DeploymentService_volumeSizeGb_range_check"
CHECK ("volumeSizeGb" IS NULL OR ("volumeSizeGb" >= 1 AND "volumeSizeGb" <= 500));
