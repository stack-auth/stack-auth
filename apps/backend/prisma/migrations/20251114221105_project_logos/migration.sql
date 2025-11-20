-- AlterTable
ALTER TABLE "Project"
RENAME COLUMN "fullLogoUrl" TO "logoFullUrl";

ALTER TABLE "Project"
ADD COLUMN "logoDarkModeUrl" TEXT,
ADD COLUMN "logoFullDarkModeUrl" TEXT;
