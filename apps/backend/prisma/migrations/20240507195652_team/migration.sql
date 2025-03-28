
-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('GLOBAL', 'TEAM');

-- AlterTable
ALTER TABLE "ProjectConfig" ADD COLUMN "createTeamOnSignUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectConfig" ALTER COLUMN "createTeamOnSignUp" DROP DEFAULT;
ALTER TABLE "ProjectConfig" ALTER COLUMN "magicLinkEnabled" DROP DEFAULT;


-- AlterTable
ALTER TABLE "ProjectUser" ALTER COLUMN "authWithEmail" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProjectUserAuthorizationCode" ALTER COLUMN "newUser" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Team" (
    "projectId" TEXT NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("projectId","teamId")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "projectId" TEXT NOT NULL,
    "projectUserId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("projectId","projectUserId","teamId")
);

-- CreateTable
CREATE TABLE "TeamMemberDirectPermission" (
    "projectId" TEXT NOT NULL,
    "projectUserId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "permissionDbId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMemberDirectPermission_pkey" PRIMARY KEY ("projectId","projectUserId","teamId","permissionDbId")
);

-- CreateTable
CREATE TABLE "Permission" (
    "queryableId" TEXT NOT NULL,
    "dbId" UUID NOT NULL,
    "projectConfigId" UUID,
    "projectId" TEXT,
    "teamId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("dbId")
);

-- CreateTable
CREATE TABLE "PermissionEdge" (
    "edgeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "parentPermissionDbId" UUID NOT NULL,
    "childPermissionDbId" UUID NOT NULL,

    CONSTRAINT "PermissionEdge_pkey" PRIMARY KEY ("edgeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Permission_projectConfigId_queryableId_key" ON "Permission"("projectConfigId", "queryableId");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_projectId_teamId_queryableId_key" ON "Permission"("projectId", "teamId", "queryableId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_projectId_projectUserId_fkey" FOREIGN KEY ("projectId", "projectUserId") REFERENCES "ProjectUser"("projectId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_projectId_teamId_fkey" FOREIGN KEY ("projectId", "teamId") REFERENCES "Team"("projectId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberDirectPermission" ADD CONSTRAINT "TeamMemberDirectPermission_projectId_projectUserId_teamId_fkey" FOREIGN KEY ("projectId", "projectUserId", "teamId") REFERENCES "TeamMember"("projectId", "projectUserId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberDirectPermission" ADD CONSTRAINT "TeamMemberDirectPermission_permissionDbId_fkey" FOREIGN KEY ("permissionDbId") REFERENCES "Permission"("dbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_projectConfigId_fkey" FOREIGN KEY ("projectConfigId") REFERENCES "ProjectConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_projectId_teamId_fkey" FOREIGN KEY ("projectId", "teamId") REFERENCES "Team"("projectId", "teamId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionEdge" ADD CONSTRAINT "PermissionEdge_parentPermissionDbId_fkey" FOREIGN KEY ("parentPermissionDbId") REFERENCES "Permission"("dbId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionEdge" ADD CONSTRAINT "PermissionEdge_childPermissionDbId_fkey" FOREIGN KEY ("childPermissionDbId") REFERENCES "Permission"("dbId") ON DELETE CASCADE ON UPDATE CASCADE;
