/*
  Warnings:

  - You are about to drop the column `role` on the `ThreadMessage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ThreadMessage" DROP COLUMN "role";

-- DropEnum
DROP TYPE "ThreadMessageRole";
