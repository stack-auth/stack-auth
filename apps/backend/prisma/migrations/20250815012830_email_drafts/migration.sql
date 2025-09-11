-- CreateEnum
CREATE TYPE "DraftThemeMode" AS ENUM ('PROJECT_DEFAULT', 'NONE', 'CUSTOM');

-- CreateTable
CREATE TABLE "EmailDraft" (
    "tenancyId" UUID NOT NULL,
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "themeMode" "DraftThemeMode" NOT NULL DEFAULT 'PROJECT_DEFAULT',
    "themeId" TEXT,
    "tsxSource" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("tenancyId","id")
);
