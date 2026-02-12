-- Session recording MVP: store session metadata in Postgres and rrweb events in S3.

CREATE TABLE "SessionRecording" (
  "id" UUID NOT NULL,
  "tenancyId" UUID NOT NULL,
  "projectUserId" UUID NOT NULL,
  "refreshTokenId" UUID NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "lastEventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("tenancyId","id")
);

CREATE TABLE "SessionRecordingChunk" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenancyId" UUID NOT NULL,
  "sessionRecordingId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "tabId" TEXT NOT NULL,
  "s3Key" TEXT NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "firstEventAt" TIMESTAMP(3) NOT NULL,
  "lastEventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SessionRecordingChunk_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SessionRecording"
  ADD CONSTRAINT "SessionRecording_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRecording"
  ADD CONSTRAINT "SessionRecording_tenancyId_projectUserId_fkey"
  FOREIGN KEY ("tenancyId", "projectUserId") REFERENCES "ProjectUser"("tenancyId", "projectUserId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRecordingChunk"
  ADD CONSTRAINT "SessionRecordingChunk_tenancyId_fkey"
  FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRecordingChunk"
  ADD CONSTRAINT "SessionRecordingChunk_sessionRecordingId_fkey"
  FOREIGN KEY ("tenancyId","sessionRecordingId") REFERENCES "SessionRecording"("tenancyId","id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SessionRecording_tenancyId_refreshTokenId_key"
  ON "SessionRecording"("tenancyId", "refreshTokenId");

CREATE INDEX "SessionRecording_tenancyId_projectUserId_startedAt_idx"
  ON "SessionRecording"("tenancyId", "projectUserId", "startedAt");

CREATE INDEX "SessionRecording_tenancyId_lastEventAt_idx"
  ON "SessionRecording"("tenancyId", "lastEventAt");

CREATE UNIQUE INDEX "SessionRecordingChunk_sessionRecordingId_batchId_key"
  ON "SessionRecordingChunk"("tenancyId", "sessionRecordingId", "batchId");

CREATE INDEX "SessionRecordingChunk_tenancyId_sessionRecordingId_createdAt_idx"
  ON "SessionRecordingChunk"("tenancyId", "sessionRecordingId", "createdAt");
