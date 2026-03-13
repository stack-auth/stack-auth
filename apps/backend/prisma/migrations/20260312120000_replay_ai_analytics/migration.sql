CREATE TYPE "ReplayAiAnalysisStatus" AS ENUM ('PENDING', 'READY', 'ERROR');
CREATE TYPE "ReplayIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "ReplayIssueCluster" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenancyId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "severity" "ReplayIssueSeverity" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "occurrenceCount" INTEGER NOT NULL,
  "affectedUserCount" INTEGER NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "topEvidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "textEmbedding" JSONB,
  "visualEmbedding" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReplayIssueCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReplayAiSummary" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenancyId" UUID NOT NULL,
  "sessionReplayId" UUID NOT NULL,
  "issueClusterId" UUID,
  "status" "ReplayAiAnalysisStatus" NOT NULL,
  "issueFingerprint" TEXT,
  "issueTitle" TEXT,
  "summary" TEXT,
  "whyLikely" TEXT,
  "severity" "ReplayIssueSeverity",
  "confidence" DOUBLE PRECISION,
  "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "visualArtifacts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "relatedReplayIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "textEmbedding" JSONB,
  "visualEmbedding" JSONB,
  "providerMetadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "errorMessage" TEXT,
  "analyzedAt" TIMESTAMP(3),
  "lastAnalyzedChunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReplayAiSummary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReplayIssueCluster_tenancyId_fingerprint_key" ON "ReplayIssueCluster"("tenancyId", "fingerprint");
CREATE UNIQUE INDEX "ReplayAiSummary_tenancyId_sessionReplayId_key" ON "ReplayAiSummary"("tenancyId", "sessionReplayId");
CREATE INDEX "ReplayAiSummary_tenancyId_issueClusterId_idx" ON "ReplayAiSummary"("tenancyId", "issueClusterId");

ALTER TABLE "ReplayIssueCluster"
  ADD CONSTRAINT "ReplayIssueCluster_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplayAiSummary"
  ADD CONSTRAINT "ReplayAiSummary_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplayAiSummary"
  ADD CONSTRAINT "ReplayAiSummary_tenancyId_sessionReplayId_fkey"
  FOREIGN KEY ("tenancyId", "sessionReplayId") REFERENCES "SessionReplay"("tenancyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReplayAiSummary"
  ADD CONSTRAINT "ReplayAiSummary_issueClusterId_fkey"
  FOREIGN KEY ("issueClusterId") REFERENCES "ReplayIssueCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
