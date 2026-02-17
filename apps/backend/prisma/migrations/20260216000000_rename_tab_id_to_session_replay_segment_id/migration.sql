ALTER TABLE "SessionRecordingChunk" RENAME COLUMN "tabId" TO "sessionReplaySegmentId";

ALTER TABLE "SessionRecording" RENAME TO "SessionReplay";
ALTER TABLE "SessionRecordingChunk" RENAME TO "SessionReplayChunk";
ALTER TABLE "SessionReplayChunk" RENAME COLUMN "sessionRecordingId" TO "sessionReplayId";
