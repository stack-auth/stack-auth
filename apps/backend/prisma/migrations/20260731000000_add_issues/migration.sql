-- Error tracking ("Issues"): persistent state for grouped `$error` occurrences.
-- Five new tables and two new enums. The occurrences themselves stay in
-- ClickHouse; these tables hold the identity, lifecycle and lifetime counters
-- that ClickHouse cannot express.
--
-- This migration is deliberately a single O(1) file with no sentinels, no
-- CREATE INDEX CONCURRENTLY, and no NOT VALID/VALIDATE split — all of which the
-- >1M-row rule would normally demand. The reason is that all five tables are
-- created empty in this same file, so every index build and every foreign-key
-- validation scans zero rows and completes in microseconds. Splitting any of it
-- across files would add migrations without shortening a single lock.
--
-- The one thing worth knowing before running this on a busy database: installing
-- the four Tenancy foreign keys briefly takes a SHARE ROW EXCLUSIVE lock on
-- "Tenancy", which is a hot table. That lock conflicts with writes to Tenancy but
-- not with reads, it is taken to attach the referential trigger (not to scan),
-- and it is held only for the duration of the ALTER. This is exactly what
-- SessionReplaySegment's Tenancy FK already does. NOT VALID would not avoid it —
-- the trigger install takes the same lock — so there is nothing to gain by
-- deferring validation.
--
-- Index rationale (all four Issue indexes are the list view's sort options, so
-- the default triage view never sorts in memory):
--   Issue_tenancyId_status_lastSeenAt   default view: unresolved, newest first
--   Issue_tenancyId_lastSeenAt          the "all statuses" tab
--   Issue_tenancyId_status_firstSeenAt  sort=first_seen
--   Issue_tenancyId_status_timesSeen    sort=events over lifetime counters
--   IssueHash_tenancyId_issueId         issue -> hashes, walked by merge/unmerge
--   IssueHash_tenancyId_state           the stale-lease sweep
--   IssueMaterialization_appliedAt      reconciler watermark + ledger pruning
-- The cascade paths from Tenancy on Issue, IssueHash and IssueRedirect are
-- prefixes of their primary keys, and IssueCounter's cascade path IS its primary
-- key, so none of them needs a dedicated index.

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "IssueHashState" AS ENUM ('LOCKED');

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
    "statusChangedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "ignoredUntil" TIMESTAMP(3),
    "assigneeUserId" UUID,
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

-- CreateIndex
CREATE INDEX "Issue_tenancyId_status_lastSeenAt_idx" ON "Issue"("tenancyId", "status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Issue_tenancyId_lastSeenAt_idx" ON "Issue"("tenancyId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Issue_tenancyId_status_firstSeenAt_idx" ON "Issue"("tenancyId", "status", "firstSeenAt");

-- CreateIndex
CREATE INDEX "Issue_tenancyId_status_timesSeen_idx" ON "Issue"("tenancyId", "status", "timesSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_tenancyId_shortId_key" ON "Issue"("tenancyId", "shortId");

-- CreateIndex
CREATE INDEX "IssueHash_tenancyId_issueId_idx" ON "IssueHash"("tenancyId", "issueId");

-- CreateIndex
CREATE INDEX "IssueHash_tenancyId_state_idx" ON "IssueHash"("tenancyId", "state");

-- CreateIndex
CREATE INDEX "IssueMaterialization_appliedAt_idx" ON "IssueMaterialization"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueRedirect_tenancyId_fromShortId_key" ON "IssueRedirect"("tenancyId", "fromShortId");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueHash" ADD CONSTRAINT "IssueHash_tenancyId_issueId_fkey" FOREIGN KEY ("tenancyId", "issueId") REFERENCES "Issue"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueHash" ADD CONSTRAINT "IssueHash_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueRedirect" ADD CONSTRAINT "IssueRedirect_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCounter" ADD CONSTRAINT "IssueCounter_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
