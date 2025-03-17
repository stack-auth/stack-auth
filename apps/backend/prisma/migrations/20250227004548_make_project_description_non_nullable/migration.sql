/*
  Warnings:

  - Made the column `description` on table `Project` required. This step will fail if there are existing NULL values in that column.

*/
-- First, update any null descriptions to empty string
UPDATE "Project" SET "description" = '' WHERE "description" IS NULL;

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "description" SET NOT NULL;
