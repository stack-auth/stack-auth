CREATE TABLE "AutomationSchedulerState" (
    "key" TEXT NOT NULL,
    "completedTenancyCursor" UUID,
    "activeTenancyId" UUID,
    "completedRuleCursor" TEXT,
    "activeRuleId" TEXT,
    "nextSubjectCursor" UUID,
    "leaseOwner" UUID,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSchedulerState_pkey" PRIMARY KEY ("key")
);

INSERT INTO "AutomationSchedulerState" ("key", "updatedAt")
VALUES ('usage-email-v1', CURRENT_TIMESTAMP);
