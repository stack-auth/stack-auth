-- Service definitions move out of the branch config and into DeploymentService
-- rows (synced from the config file's `services` export by `hexclave deploy`),
-- so the rows gain the definition-only fields the config used to hold: the dev
-- command and the env var definitions. Both tables involved are small (the
-- Deployments app is in alpha), and PG11+ adds columns with constant defaults
-- without a table rewrite, so no batching sentinel is needed here.

-- AlterTable
-- definitionSyncedAt stays NULL for pre-existing rows on purpose: their
-- definitions lived in the (now-dropped) branch config section and are NOT
-- backfilled here, so deploys must refuse them until a `hexclave deploy`
-- syncs a real definition.
ALTER TABLE "DeploymentService" ADD COLUMN "definitionSyncedAt" TIMESTAMP(3),
ADD COLUMN     "devCommand" TEXT,
ADD COLUMN     "env" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "DeploymentSecret" (
    "projectId" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "encrypted" JSONB NOT NULL,

    CONSTRAINT "DeploymentSecret_pkey" PRIMARY KEY ("projectId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentSecret_projectId_key_key" ON "DeploymentSecret"("projectId", "key");

-- AddForeignKey
ALTER TABLE "DeploymentSecret" ADD CONSTRAINT "DeploymentSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
