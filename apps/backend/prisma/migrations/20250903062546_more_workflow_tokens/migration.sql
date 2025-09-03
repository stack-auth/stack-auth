/*
  Warnings:

  - Added the required column `executionId` to the `WorkflowTriggerToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `triggerId` to the `WorkflowTriggerToken` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WorkflowTriggerToken" ADD COLUMN     "executionId" UUID NOT NULL,
ADD COLUMN     "triggerId" UUID NOT NULL;
