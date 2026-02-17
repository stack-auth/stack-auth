export type AdminListSessionReplaysOptions = {
  limit?: number,
  cursor?: string,
};

export type AdminListSessionReplaysResponse = {
  items: Array<{
    id: string,
    project_user: {
      id: string,
      display_name: string | null,
      primary_email: string | null,
    },
    started_at_millis: number,
    last_event_at_millis: number,
    chunk_count: number,
    event_count: number,
  }>,
  pagination: {
    next_cursor: string | null,
  },
};

export type AdminListSessionReplayChunksOptions = {
  limit?: number,
  cursor?: string,
};

export type AdminListSessionReplayChunksResponse = {
  items: Array<{
    id: string,
    batch_id: string,
    session_replay_segment_id: string | null,
    browser_session_id: string | null,
    event_count: number,
    byte_length: number,
    first_event_at_millis: number,
    last_event_at_millis: number,
    created_at_millis: number,
  }>,
  pagination: {
    next_cursor: string | null,
  },
};

export type AdminGetSessionReplayChunkEventsResponse = {
  events: unknown[],
};

export type AdminGetSessionReplayAllEventsResponse = {
  chunks: Array<{
    id: string,
    batch_id: string,
    session_replay_segment_id: string | null,
    event_count: number,
    byte_length: number,
    first_event_at_millis: number,
    last_event_at_millis: number,
    created_at_millis: number,
  }>,
  chunk_events: Array<{
    chunk_id: string,
    events: unknown[],
  }>,
};
