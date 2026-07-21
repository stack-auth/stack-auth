ALTER TABLE "AutomationSchedulerState"
ADD COLUMN "activeRuleEvaluationStartedAt" TIMESTAMP(3);

-- Preserve an in-progress unpublished scheduler checkpoint across deployment. The singleton's
-- updatedAt is the closest durable lower-fidelity start marker available before this column exists.
UPDATE "AutomationSchedulerState"
SET "activeRuleEvaluationStartedAt" = "updatedAt"
WHERE "activeRuleId" IS NOT NULL;

CREATE TABLE "AutomationRuleScheduleState" (
  "tenancyId" UUID NOT NULL,
  "ruleId" TEXT NOT NULL,
  "lastCompletedEvaluationStartedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AutomationRuleScheduleState_pkey" PRIMARY KEY ("tenancyId", "ruleId"),
  CONSTRAINT "AutomationRuleScheduleState_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutomationRuleExecutionState_tenancy_rule_retry_idx"
ON "AutomationRuleExecutionState"("tenancyId", "ruleId", "nextRetryAt");
