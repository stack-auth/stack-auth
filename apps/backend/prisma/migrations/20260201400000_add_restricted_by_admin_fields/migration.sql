-- Add restricted by admin fields to ProjectUser
ALTER TABLE "ProjectUser" ADD COLUMN "restrictedByAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectUser" ADD COLUMN "restrictedByAdminReason" TEXT;
