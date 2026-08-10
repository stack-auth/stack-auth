-- Error tracking: issues, grouping hashes, the exactly-once materialization
-- ledger, ownership/activity/saved-search metadata, the alert surface and the
-- attachment ledger.
--
-- Every table here is new, so indexes and foreign-key validation are O(1).
-- Intermediate follow-up migrations that only existed while this surface was
-- under development are folded into the final CREATE shapes (correct alert
-- rule scope key, no IssueActivity actor FK, Issue/IssueHash columns present
-- from day one).
--
-- The Tenancy composite unique key that these scope foreign keys reference is
-- created concurrently by 20260726000000_add_releases, which orders before
-- this migration.


-- SPLIT_STATEMENT_SENTINEL

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'IGNORED');
CREATE TYPE "IssueHashState" AS ENUM ('LOCKED');
CREATE TYPE "IssueHashGroupingRole" AS ENUM ('PRIMARY', 'SECONDARY');
CREATE TYPE "IssuePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "IssueOwnerType" AS ENUM ('USER', 'TEAM');
CREATE TYPE "IssueOwnerSource" AS ENUM ('MANUAL', 'OWNERSHIP_RULE', 'CODEOWNERS', 'SUSPECT_COMMIT', 'SEER_SUGGESTED');
CREATE TYPE "IssueActivityType" AS ENUM ('COMMENT', 'STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'PRIORITY_CHANGED', 'TEAM_CHANGED', 'OWNER_CHANGED', 'SUBSCRIPTION_CHANGED', 'BOOKMARK_CHANGED', 'REGRESSED');
CREATE TYPE "IssueSubjectType" AS ENUM ('USER', 'TEAM');
CREATE TYPE "IssueAlertEventKind" AS ENUM ('NEW', 'REGRESSION', 'OCCURRENCE');
CREATE TYPE "IssueAlertDeliveryState" AS ENUM ('CLAIMED', 'SUPPRESSED', 'ENQUEUED', 'DELIVERED', 'FAILED', 'DROPPED');
CREATE TYPE "IssueAlertDeliveryOutcome" AS ENUM ('NONE', 'COOLDOWN_ACTIVE', 'WORKFLOW_ENQUEUED', 'WORKFLOW_DELIVERED', 'WORKFLOW_FAILED', 'WORKFLOW_DROPPED', 'INVALID_RULE');

-- CreateTable
CREATE TABLE "Issue" (
    "id" UUID NOT NULL,
    "tenancyId" UUID NOT NULL,
    "shortId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "culprit" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT true,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "status" "IssueStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "priority" "IssuePriority",
    "statusChangedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "ignoredUntil" TIMESTAMP(3),
    "assigneeUserId" UUID,
    "assignedTeamId" UUID,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "regressedAt" TIMESTAMP(3),
    "timesSeen" BIGINT NOT NULL DEFAULT 0,
    "countersTruncatedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "serviceName" TEXT,
    "deploymentEnvironmentName" TEXT,
    "firstSeenRelease" TEXT,
    "lastSeenRelease" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("tenancyId","id")
);

-- CreateTable
-- Many-to-one from day one: a scalar Issue.hash would make the app/system
-- variant split, merge, unmerge and every future grouping-algorithm change
-- require migrating the whole hash space instead of rewriting rows here.
CREATE TABLE "IssueHash" (
    "tenancyId" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "issueId" UUID NOT NULL,
    "groupingConfigId" TEXT NOT NULL,
    -- Nullable for legacy rows created before durable grouping provenance. New
    -- rows record whether this hash was the owning primary or a transition alias.
    "groupingRole" "IssueHashGroupingRole",
    "groupingVariant" VARCHAR(32),
    "groupingProvenance" JSONB,
    -- A committed lease, not an in-transaction flag: set in one transaction and
    -- cleared in another so concurrent ingest can actually observe it and skip
    -- the hash. "lockedAt" is what makes a crashed merge recoverable by a sweep
    -- rather than wedging the hash as LOCKED forever.
    "state" "IssueHashState",
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Also the concurrency control: two simultaneous first-sightings of the same
    -- error race on this key, and exactly one wins.
    CONSTRAINT "IssueHash_pkey" PRIMARY KEY ("tenancyId","hash")
);

-- CreateTable
-- The exactly-once ledger. The INSERT is the idempotency check: ON CONFLICT DO
-- NOTHING returning 0 rows means this ingest batch's deltas were already applied.
-- Without it, a batch retried after ClickHouse's insert-token dedup would write
-- no new occurrences yet double-count every Postgres counter.
--
-- No Tenancy foreign key on purpose: this row is written once per ingest batch on
-- the write path, and an FK would take a row-share lock on the hot Tenancy row
-- every time. Retention is by "appliedAt" pruning instead, which also covers rows
-- left behind by a deleted tenancy.
CREATE TABLE "IssueMaterialization" (
    "tenancyId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueMaterialization_pkey" PRIMARY KEY ("tenancyId","batchId")
);

-- CreateTable
-- Merge keeps the source issue's id AND short id resolvable. Existing redirects
-- are rewritten to the new target on merge rather than chained, so a lookup is
-- always exactly one hop however many times an issue has been merged. No FK in
-- either direction: "fromIssueId" names a row the merge has already deleted.
CREATE TABLE "IssueRedirect" (
    "tenancyId" UUID NOT NULL,
    "fromIssueId" UUID NOT NULL,
    "toIssueId" UUID NOT NULL,
    "fromShortId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueRedirect_pkey" PRIMARY KEY ("tenancyId","fromIssueId")
);

-- CreateTable
-- Short id allocator. Scoped to a Tenancy, which is (project, branch) — so short
-- ids are per project AND branch, not per project. BIGINT so a firehose project
-- cannot wrap the counter.
CREATE TABLE "IssueCounter" (
    "tenancyId" UUID NOT NULL,
    "nextShortId" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "IssueCounter_pkey" PRIMARY KEY ("tenancyId")
);

CREATE TABLE "IssueAlertRule" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleKey" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueAlertRule_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "IssueAlertRule_version_check" CHECK ("version" > 0),
    CONSTRAINT "IssueAlertRule_schemaVersion_check" CHECK ("schemaVersion" > 0),
    CONSTRAINT "IssueAlertRule_config_object_check" CHECK (jsonb_typeof("config") = 'object'),
    CONSTRAINT "IssueAlertRule_config_size_check" CHECK (octet_length("config"::text) <= 65536)
);

CREATE TABLE "IssueAlertCooldownClaim" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleId" UUID NOT NULL,
    "cooldownKey" VARCHAR(256) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastClaimedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueAlertCooldownClaim_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "IssueAlertCooldownClaim_key_check" CHECK (length("cooldownKey") > 0)
);

CREATE TABLE "IssueAlertDelivery" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ruleId" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "occurrenceId" VARCHAR(256) NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "eventKind" "IssueAlertEventKind" NOT NULL,
    "deduplicationKey" VARCHAR(256) NOT NULL,
    "cooldownKey" VARCHAR(256) NOT NULL,
    "cooldownDurationSeconds" INTEGER NOT NULL,
    "cooldownExpiresAt" TIMESTAMP(3),
    "state" "IssueAlertDeliveryState" NOT NULL DEFAULT 'CLAIMED',
    "outcome" "IssueAlertDeliveryOutcome" NOT NULL DEFAULT 'NONE',
    "workflowEventId" UUID,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "lastError" VARCHAR(8192),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enqueuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueAlertDelivery_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "IssueAlertDelivery_keys_check" CHECK (length("deduplicationKey") > 0 AND length("cooldownKey") > 0),
    CONSTRAINT "IssueAlertDelivery_cooldown_check" CHECK ("cooldownDurationSeconds" BETWEEN 0 AND 2592000),
    CONSTRAINT "IssueAlertDelivery_attempts_check" CHECK ("attemptCount" >= 0 AND "replayCount" >= 0)
);

CREATE TABLE "ErrorAttachment" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" VARCHAR(32) NOT NULL,
  "occurrenceId" VARCHAR(256),
  "idempotencyKey" VARCHAR(256) NOT NULL,
  "filename" VARCHAR(255) NOT NULL,
  "contentType" VARCHAR(255) NOT NULL,
  "attachmentType" VARCHAR(64) NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "storageKey" VARCHAR(1024) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ErrorAttachment_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "ErrorAttachment_byteLength_check" CHECK ("byteLength" > 0),
  CONSTRAINT "ErrorAttachment_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "IssueOwner" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issueId" UUID NOT NULL,
  "ownerType" "IssueOwnerType" NOT NULL,
  "ownerUserId" UUID,
  "ownerTeamId" UUID,
  "source" "IssueOwnerSource" NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueOwner_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "IssueOwner_owner_check" CHECK (
    ("ownerType" = 'USER' AND "ownerUserId" IS NOT NULL AND "ownerTeamId" IS NULL)
    OR ("ownerType" = 'TEAM' AND "ownerUserId" IS NULL AND "ownerTeamId" IS NOT NULL)
  ),
  CONSTRAINT "IssueOwner_context_size_check" CHECK ("context" IS NULL OR pg_column_size("context") <= 65536)
);

CREATE TABLE "IssueActivity" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issueId" UUID NOT NULL,
  "actorUserId" UUID,
  "type" "IssueActivityType" NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueActivity_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "IssueActivity_data_size_check" CHECK (pg_column_size("data") <= 65536)
  -- No actor FK on purpose: system/automation actors and deleted users must still
  -- leave an auditable activity row. actorUserId is informational only.
);

CREATE TABLE "IssueComment" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issueId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "IssueComment_body_size_check" CHECK (char_length("body") BETWEEN 1 AND 10000)
);

CREATE TABLE "IssueSubscription" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "issueId" UUID NOT NULL,
  "subjectType" "IssueSubjectType" NOT NULL,
  "subjectUserId" UUID,
  "subjectTeamId" UUID,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "reason" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueSubscription_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "IssueSubscription_subject_check" CHECK (
    ("subjectType" = 'USER' AND "subjectUserId" IS NOT NULL AND "subjectTeamId" IS NULL)
    OR ("subjectType" = 'TEAM' AND "subjectUserId" IS NULL AND "subjectTeamId" IS NOT NULL)
  )
);

CREATE TABLE "IssueBookmark" (
  "tenancyId" UUID NOT NULL,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "issueId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IssueBookmark_pkey" PRIMARY KEY ("tenancyId", "issueId", "userId")
);

CREATE TABLE "IssueSavedSearchView" (
    "tenancyId" UUID NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(128) NOT NULL,
    "nameKey" VARCHAR(128) NOT NULL,
    "visibility" VARCHAR(16) NOT NULL,
    "ownerUserId" UUID,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueSavedSearchView_pkey" PRIMARY KEY ("tenancyId", "id"),
    CONSTRAINT "IssueSavedSearchView_schemaVersion_check" CHECK ("schemaVersion" > 0),
    CONSTRAINT "IssueSavedSearchView_name_check" CHECK (char_length("name") BETWEEN 1 AND 128),
    CONSTRAINT "IssueSavedSearchView_nameKey_check" CHECK (char_length("nameKey") BETWEEN 1 AND 128 AND "nameKey" = lower("nameKey")),
    CONSTRAINT "IssueSavedSearchView_visibility_check" CHECK ("visibility" IN ('private', 'project')),
    CONSTRAINT "IssueSavedSearchView_private_owner_check" CHECK ("visibility" <> 'private' OR "ownerUserId" IS NOT NULL),
    CONSTRAINT "IssueSavedSearchView_query_object_check" CHECK (jsonb_typeof("query") = 'object'),
    CONSTRAINT "IssueSavedSearchView_query_size_check" CHECK (octet_length("query"::text) <= 16384)
);

-- CreateIndex
CREATE INDEX "Issue_tenancyId_status_lastSeenAt_idx" ON "Issue"("tenancyId", "status", "lastSeenAt");
CREATE INDEX "Issue_tenancyId_lastSeenAt_idx" ON "Issue"("tenancyId", "lastSeenAt");
CREATE INDEX "Issue_tenancyId_status_firstSeenAt_idx" ON "Issue"("tenancyId", "status", "firstSeenAt");
CREATE INDEX "Issue_tenancyId_status_timesSeen_idx" ON "Issue"("tenancyId", "status", "timesSeen");
CREATE UNIQUE INDEX "Issue_tenancyId_shortId_key" ON "Issue"("tenancyId", "shortId");
CREATE INDEX "IssueHash_tenancyId_issueId_idx" ON "IssueHash"("tenancyId", "issueId");
CREATE INDEX "IssueHash_tenancyId_state_idx" ON "IssueHash"("tenancyId", "state");
CREATE INDEX "IssueMaterialization_appliedAt_idx" ON "IssueMaterialization"("appliedAt");
CREATE UNIQUE INDEX "IssueRedirect_tenancyId_fromShortId_key" ON "IssueRedirect"("tenancyId", "fromShortId");

CREATE UNIQUE INDEX "IssueAlertRule_tenancyId_id_scope_key"
  ON "IssueAlertRule" ("tenancyId", "id", "projectId", "branchId");
CREATE UNIQUE INDEX "IssueAlertRule_scope_ruleKey_version_key"
  ON "IssueAlertRule" ("tenancyId", "projectId", "branchId", "ruleKey", "version");
CREATE INDEX "IssueAlertRule_active_scope_idx"
  ON "IssueAlertRule" ("tenancyId", "projectId", "branchId", "enabled", "ruleKey", "version");
CREATE UNIQUE INDEX "IssueAlertCooldownClaim_tenancyId_cooldownKey_key"
  ON "IssueAlertCooldownClaim" ("tenancyId", "cooldownKey");
CREATE UNIQUE INDEX "IssueAlertCooldownClaim_scope_key"
  ON "IssueAlertCooldownClaim" ("tenancyId", "cooldownKey", "projectId", "branchId");
CREATE INDEX "IssueAlertCooldownClaim_scope_expiresAt_idx"
  ON "IssueAlertCooldownClaim" ("tenancyId", "projectId", "branchId", "expiresAt");
CREATE UNIQUE INDEX "IssueAlertDelivery_tenancyId_deduplicationKey_key"
  ON "IssueAlertDelivery" ("tenancyId", "deduplicationKey");
CREATE INDEX "IssueAlertDelivery_retry_idx"
  ON "IssueAlertDelivery" ("tenancyId", "projectId", "branchId", "state", "nextRetryAt");
CREATE INDEX "IssueAlertDelivery_scope_createdAt_idx"
  ON "IssueAlertDelivery" ("tenancyId", "projectId", "branchId", "createdAt");
CREATE INDEX "IssueAlertDelivery_workflowEvent_idx"
  ON "IssueAlertDelivery" ("tenancyId", "workflowEventId");

CREATE UNIQUE INDEX "ErrorAttachment_scope_idempotency_key"
  ON "ErrorAttachment" ("tenancyId", "projectId", "branchId", "idempotencyKey");
CREATE UNIQUE INDEX "ErrorAttachment_scope_event_digest_filename_key"
  ON "ErrorAttachment" ("tenancyId", "projectId", "branchId", "eventId", "sha256", "filename");
CREATE INDEX "ErrorAttachment_scope_event_createdAt_idx"
  ON "ErrorAttachment" ("tenancyId", "projectId", "branchId", "eventId", "createdAt" DESC);

CREATE UNIQUE INDEX "IssueOwner_scope_natural_key"
  ON "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "ownerType", "ownerUserId", "ownerTeamId", "source");
CREATE INDEX "IssueOwner_scope_issue_updatedAt_idx"
  ON "IssueOwner" ("tenancyId", "projectId", "branchId", "issueId", "updatedAt");
CREATE UNIQUE INDEX "IssueActivity_scope_issue_idempotency_key"
  ON "IssueActivity" ("tenancyId", "projectId", "branchId", "issueId", "idempotencyKey");
CREATE INDEX "IssueActivity_scope_issue_occurredAt_idx"
  ON "IssueActivity" ("tenancyId", "projectId", "branchId", "issueId", "occurredAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "IssueComment_scope_issue_idempotency_key"
  ON "IssueComment" ("tenancyId", "projectId", "branchId", "issueId", "idempotencyKey");
CREATE INDEX "IssueComment_scope_issue_createdAt_idx"
  ON "IssueComment" ("tenancyId", "projectId", "branchId", "issueId", "createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "IssueSubscription_scope_natural_key"
  ON "IssueSubscription" ("tenancyId", "projectId", "branchId", "issueId", "subjectType", "subjectUserId", "subjectTeamId");
CREATE INDEX "IssueSubscription_scope_issue_active_idx"
  ON "IssueSubscription" ("tenancyId", "projectId", "branchId", "issueId", "isActive");
CREATE INDEX "IssueBookmark_scope_user_createdAt_idx"
  ON "IssueBookmark" ("tenancyId", "projectId", "branchId", "userId", "createdAt" DESC);

CREATE UNIQUE INDEX "IssueSavedSearchView_scope_name_key"
  ON "IssueSavedSearchView" ("tenancyId", "projectId", "branchId", "nameKey");
CREATE INDEX "IssueSavedSearchView_scope_updatedAt_idx"
  ON "IssueSavedSearchView" ("tenancyId", "projectId", "branchId", "visibility", "ownerUserId", "updatedAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigned_team_fkey" FOREIGN KEY ("tenancyId", "assignedTeamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IssueHash" ADD CONSTRAINT "IssueHash_tenancyId_issueId_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueHash" ADD CONSTRAINT "IssueHash_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueRedirect" ADD CONSTRAINT "IssueRedirect_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueCounter" ADD CONSTRAINT "IssueCounter_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueAlertRule" ADD CONSTRAINT "IssueAlertRule_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy" ("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertRule" ADD CONSTRAINT "IssueAlertRule_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueAlertCooldownClaim" ADD CONSTRAINT "IssueAlertCooldownClaim_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy" ("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertCooldownClaim" ADD CONSTRAINT "IssueAlertCooldownClaim_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertCooldownClaim" ADD CONSTRAINT "IssueAlertCooldownClaim_rule_scope_fkey"
  FOREIGN KEY ("tenancyId", "ruleId", "projectId", "branchId")
  REFERENCES "IssueAlertRule" ("tenancyId", "id", "projectId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IssueAlertDelivery" ADD CONSTRAINT "IssueAlertDelivery_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy" ("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertDelivery" ADD CONSTRAINT "IssueAlertDelivery_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertDelivery" ADD CONSTRAINT "IssueAlertDelivery_rule_scope_fkey"
  FOREIGN KEY ("tenancyId", "ruleId", "projectId", "branchId")
  REFERENCES "IssueAlertRule" ("tenancyId", "id", "projectId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssueAlertDelivery" ADD CONSTRAINT "IssueAlertDelivery_issue_fkey"
  FOREIGN KEY ("tenancyId", "issueId")
  REFERENCES "Issue" ("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueAlertDelivery" ADD CONSTRAINT "IssueAlertDelivery_cooldown_scope_fkey"
  FOREIGN KEY ("tenancyId", "cooldownKey", "projectId", "branchId")
  REFERENCES "IssueAlertCooldownClaim" ("tenancyId", "cooldownKey", "projectId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ErrorAttachment" ADD CONSTRAINT "ErrorAttachment_tenancyId_projectId_branchId_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErrorAttachment" ADD CONSTRAINT "ErrorAttachment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_tenancy_scope_fkey" FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_issue_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_user_fkey" FOREIGN KEY ("tenancyId", "ownerUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueOwner" ADD CONSTRAINT "IssueOwner_team_fkey" FOREIGN KEY ("tenancyId", "ownerTeamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_tenancy_scope_fkey" FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueActivity" ADD CONSTRAINT "IssueActivity_issue_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_tenancy_scope_fkey" FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issue_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_author_fkey" FOREIGN KEY ("tenancyId", "authorUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_tenancy_scope_fkey" FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_issue_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_user_fkey" FOREIGN KEY ("tenancyId", "subjectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssueSubscription" ADD CONSTRAINT "IssueSubscription_team_fkey" FOREIGN KEY ("tenancyId", "subjectTeamId") REFERENCES "Team"("tenancyId", "teamId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IssueBookmark" ADD CONSTRAINT "IssueBookmark_tenancy_scope_fkey" FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy"("id", "projectId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueBookmark" ADD CONSTRAINT "IssueBookmark_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueBookmark" ADD CONSTRAINT "IssueBookmark_issue_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueBookmark" ADD CONSTRAINT "IssueBookmark_user_fkey" FOREIGN KEY ("tenancyId", "userId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueSavedSearchView"
  ADD CONSTRAINT "IssueSavedSearchView_tenancy_scope_fkey"
  FOREIGN KEY ("tenancyId", "projectId", "branchId")
  REFERENCES "Tenancy" ("id", "projectId", "branchId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueSavedSearchView"
  ADD CONSTRAINT "IssueSavedSearchView_project_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueSavedSearchView"
  ADD CONSTRAINT "IssueSavedSearchView_owner_fkey"
  FOREIGN KEY ("tenancyId", "ownerUserId")
  REFERENCES "ProjectUser" ("tenancyId", "projectUserId")
  ON DELETE CASCADE ON UPDATE CASCADE;
