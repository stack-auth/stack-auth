ALTER TABLE "SessionRecordingChunk" RENAME COLUMN "tabId" TO "sessionReplaySegmentId";

ALTER TABLE "SessionRecording" RENAME TO "SessionReplay";
ALTER TABLE "SessionRecordingChunk" RENAME TO "SessionReplayChunk";
ALTER TABLE "SessionReplayChunk" RENAME COLUMN "sessionRecordingId" TO "sessionReplayId";

-- Rename primary key constraints
ALTER TABLE "SessionReplay" RENAME CONSTRAINT "SessionRecording_pkey" TO "SessionReplay_pkey";
ALTER TABLE "SessionReplayChunk" RENAME CONSTRAINT "SessionRecordingChunk_pkey" TO "SessionReplayChunk_pkey";

-- Rename foreign key constraints
ALTER TABLE "SessionReplay" RENAME CONSTRAINT "SessionRecording_tenancyId_fkey" TO "SessionReplay_tenancyId_fkey";
ALTER TABLE "SessionReplay" RENAME CONSTRAINT "SessionRecording_tenancyId_projectUserId_fkey" TO "SessionReplay_tenancyId_projectUserId_fkey";
ALTER TABLE "SessionReplayChunk" RENAME CONSTRAINT "SessionRecordingChunk_tenancyId_fkey" TO "SessionReplayChunk_tenancyId_fkey";
ALTER TABLE "SessionReplayChunk" RENAME CONSTRAINT "SessionRecordingChunk_tenancyId_sessionRecordingId_fkey" TO "SessionReplayChunk_tenancyId_sessionReplayId_fkey";

-- Rename indexes
ALTER INDEX "SessionRecording_tenancyId_lastEventAt_idx" RENAME TO "SessionReplay_tenancyId_lastEventAt_idx";
ALTER INDEX "SessionRecording_tenancyId_projectUserId_startedAt_idx" RENAME TO "SessionReplay_tenancyId_projectUserId_startedAt_idx";
ALTER INDEX "SessionRecording_tenancyId_refreshTokenId_updatedAt_idx" RENAME TO "SessionReplay_tenancyId_refreshTokenId_updatedAt_idx";
ALTER INDEX "SessionRecordingChunk_tenancyId_sessionRecordingId_batchId_key" RENAME TO "SessionReplayChunk_tenancyId_sessionReplayId_batchId_key";
ALTER INDEX "SessionRecordingChunk_tenancyId_sessionRecordingId_createdA_idx" RENAME TO "SessionReplayChunk_tenancyId_sessionReplayId_createdAt_idx";
