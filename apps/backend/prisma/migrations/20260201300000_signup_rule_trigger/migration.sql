-- CreateTable
CREATE TABLE "SignupRuleTrigger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenancyId" UUID NOT NULL,
    "ruleId" TEXT NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupRuleTrigger_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateIndex
CREATE INDEX "SignupRuleTrigger_tenancyId_ruleId_triggeredAt_idx" ON "SignupRuleTrigger"("tenancyId", "ruleId", "triggeredAt");

-- CreateIndex
CREATE INDEX "SignupRuleTrigger_tenancyId_triggeredAt_idx" ON "SignupRuleTrigger"("tenancyId", "triggeredAt");
