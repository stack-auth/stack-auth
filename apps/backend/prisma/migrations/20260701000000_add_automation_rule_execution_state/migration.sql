CREATE TABLE "AutomationRuleExecutionState" (
  "tenancyId" UUID NOT NULL,
  "ruleId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "signalKey" TEXT NOT NULL,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL,
  "lastActionAt" TIMESTAMP(3),
  "lastEmailOutboxId" UUID,
  "lastSourceSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AutomationRuleExecutionState_pkey" PRIMARY KEY ("tenancyId", "ruleId", "subjectType", "subjectId", "signalKey"),
  CONSTRAINT "AutomationRuleExecutionState_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AutomationRuleExecutionState_tenancy_rule_triggered_idx" ON "AutomationRuleExecutionState"("tenancyId", "ruleId", "lastTriggeredAt");
