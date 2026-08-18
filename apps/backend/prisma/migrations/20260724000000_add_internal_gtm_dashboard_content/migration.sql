-- CreateTable
CREATE TABLE "GtmInsight" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "impactScore" INTEGER NOT NULL DEFAULT 0,
    "timesSeen" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GtmInsight_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GtmInsight_domain_check" CHECK ("domain" IN ('product', 'users', 'ads', 'outreach', 'content', 'revenue')),
    CONSTRAINT "GtmInsight_kind_check" CHECK ("kind" IN ('funnel_dropoff', 'segment_lift', 'retention', 'send_time', 'checkout_abandonment', 'friction_hotspot', 'qualitative_theme', 'data_gap', 'measurement')),
    CONSTRAINT "GtmInsight_status_check" CHECK ("status" IN ('new', 'surfaced', 'acknowledged', 'dismissed', 'measured', 'archived')),
    CONSTRAINT "GtmInsight_confidence_check" CHECK ("confidence" IN ('high', 'medium', 'low')),
    CONSTRAINT "GtmInsight_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 200),
    CONSTRAINT "GtmInsight_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 5000),
    CONSTRAINT "GtmInsight_impact_score_check" CHECK ("impactScore" BETWEEN 0 AND 100),
    CONSTRAINT "GtmInsight_times_seen_check" CHECK ("timesSeen" >= 1)
);

-- CreateTable
CREATE TABLE "GtmAction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "verdict" TEXT,
    "retrospectiveText" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    CONSTRAINT "GtmAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GtmAction_domain_check" CHECK ("domain" IN ('product', 'users', 'ads', 'outreach', 'content', 'revenue')),
    CONSTRAINT "GtmAction_type_check" CHECK ("type" IN ('checkout_recovery_email', 'broadcast_email', 'config_change')),
    CONSTRAINT "GtmAction_status_check" CHECK ("status" IN ('proposed', 'approved', 'executing', 'executed', 'failed', 'rejected', 'expired')),
    CONSTRAINT "GtmAction_verdict_check" CHECK ("verdict" IS NULL OR "verdict" IN ('worked', 'didnt_work', 'inconclusive', 'never_measured', 'rejected_by_you', 'expired')),
    CONSTRAINT "GtmAction_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 200),
    CONSTRAINT "GtmAction_summary_length_check" CHECK (char_length("summary") BETWEEN 1 AND 2000),
    CONSTRAINT "GtmAction_retrospective_length_check" CHECK ("retrospectiveText" IS NULL OR char_length("retrospectiveText") <= 5000)
);

-- CreateTable
CREATE TABLE "GtmNote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "domain" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GtmNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GtmNote_domain_check" CHECK ("domain" IN ('product', 'users', 'ads', 'outreach', 'content', 'revenue')),
    CONSTRAINT "GtmNote_category_check" CHECK ("category" IN ('company', 'audience', 'strategy', 'user_preference', 'learning')),
    CONSTRAINT "GtmNote_source_check" CHECK ("source" IN ('chat', 'run', 'user')),
    CONSTRAINT "GtmNote_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 500)
);

-- CreateTable
-- Project-scoped GTM intake. The unique key makes the first-open flow
-- idempotent and lets the service safely retry a submitted form.
CREATE TABLE "GtmOnboarding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "domain" VARCHAR(253),
    "phone" VARCHAR(50) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GtmOnboarding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GtmOnboarding_domain_length_check" CHECK ("domain" IS NULL OR char_length("domain") BETWEEN 1 AND 253),
    CONSTRAINT "GtmOnboarding_phone_length_check" CHECK (char_length("phone") BETWEEN 7 AND 50),
    CONSTRAINT "GtmOnboarding_notes_length_check" CHECK (char_length("notes") <= 2000)
);

-- CreateIndex
CREATE INDEX "GtmInsight_projectId_branchId_createdAt_id_idx" ON "GtmInsight"("projectId", "branchId", "createdAt" DESC, "id" DESC);
CREATE INDEX "GtmAction_projectId_branchId_createdAt_id_idx" ON "GtmAction"("projectId", "branchId", "createdAt" DESC, "id" DESC);
CREATE INDEX "GtmNote_projectId_branchId_createdAt_id_idx" ON "GtmNote"("projectId", "branchId", "createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "GtmOnboarding_projectId_branchId_key" ON "GtmOnboarding"("projectId", "branchId");

-- AddForeignKey
ALTER TABLE "GtmInsight" ADD CONSTRAINT "GtmInsight_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtmAction" ADD CONSTRAINT "GtmAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtmNote" ADD CONSTRAINT "GtmNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtmOnboarding" ADD CONSTRAINT "GtmOnboarding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
