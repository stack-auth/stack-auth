-- Whether a deployment produced a build log. A deployment whose every service
-- runs an already-built image starts no builder machine, so it has none.
--
-- Defaults true: every existing row predates prebuilt images and is therefore a
-- source build, which is what true says. No backfill needed for the same reason.
ALTER TABLE "Deployment" ADD COLUMN "hasBuildLogs" BOOLEAN NOT NULL DEFAULT true;
