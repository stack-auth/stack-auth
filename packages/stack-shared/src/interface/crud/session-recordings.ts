export type AdminListSessionRecordingsOptions = {
  limit?: number,
  cursor?: string,
};

export type AdminListSessionRecordingsResponse = {
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

export type AdminListSessionRecordingChunksOptions = {
  limit?: number,
  cursor?: string,
};

export type AdminListSessionRecordingChunksResponse = {
  items: Array<{
    id: string,
    batch_id: string,
    tab_id: string | null,
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

export type AdminGetSessionRecordingChunkEventsResponse = {
  events: unknown[],
};

export type AdminGetSessionRecordingAllEventsResponse = {
  chunks: Array<{
    id: string,
    batch_id: string,
    tab_id: string | null,
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

