export type AdminSessionRecording = {
  id: string,
  projectUser: {
    id: string,
    displayName: string | null,
    primaryEmail: string | null,
  },
  startedAt: Date,
  lastEventAt: Date,
  chunkCount: number,
  eventCount: number,
};

export type AdminSessionRecordingChunk = {
  id: string,
  batchId: string,
  sessionReplaySegmentId: string | null,
  browserSessionId: string | null,
  eventCount: number,
  byteLength: number,
  firstEventAt: Date,
  lastEventAt: Date,
  createdAt: Date,
};

export type ListSessionRecordingsOptions = {
  limit?: number,
  cursor?: string,
};

export type ListSessionRecordingsResult = {
  items: AdminSessionRecording[],
  nextCursor: string | null,
};

export type ListSessionRecordingChunksOptions = {
  limit?: number,
  cursor?: string,
};

export type ListSessionRecordingChunksResult = {
  items: AdminSessionRecordingChunk[],
  nextCursor: string | null,
};

export type SessionRecordingAllEventsResult = {
  chunks: Array<{
    id: string,
    batchId: string,
    sessionReplaySegmentId: string | null,
    eventCount: number,
    byteLength: number,
    firstEventAt: Date,
    lastEventAt: Date,
    createdAt: Date,
  }>,
  chunkEvents: Array<{
    chunkId: string,
    events: unknown[],
  }>,
};
