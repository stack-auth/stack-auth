import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { stripLoneSurrogates, type ClickHouseClient } from "./clickhouse";

/**
 * Spans are telemetry facts (time intervals) — the sibling of events. They are
 * written DIRECTLY to ClickHouse (`analytics_internal.spans`), the same way
 * events are, and never go through the ext-db-sync (that is a dimension
 * replicator, not a telemetry pipe). See the plan/notes in
 * `apps/backend/scripts/clickhouse-migrations.ts` for the table + `default.spans` view.
 */

// Typed-id prefixes. Applied ONLY to a span's own `id` and to the values inside
// `parent_span_ids` — so a heterogeneous parent array is self-describing. They are
// NEVER applied to scalar identity columns (project_id, user_id, session_replay_id, …),
// which stay raw so existing customer SQL keeps working.
export const SPAN_ID_PREFIXES = {
  sessionReplay: "sri-",
  // The per-tab id. The SDK mints exactly one `session_replay_segment_id` per
  // browser tab, so despite the "segment" name it IS the per-tab id — there is
  // only this one level (there is no separate "tab"). Named "segment" to stay
  // consistent with the pre-existing `session_replay_segment_id` column + SDK field.
  sessionReplaySegment: "srsi-",
  refreshToken: "rti-",
  user: "ui-",
  team: "ti-",
  project: "pi-",
  branch: "bi-",
  // User-defined spans created via the SDK's startSpan(). Applied server-side to
  // the client-generated raw uuid and to every id inside a client-supplied parent
  // chain — clients only ever transmit raw custom uuids, never prefixed ids.
  custom: "cs-",
} as const;

export const SPAN_TYPES = {
  sessionReplay: "$session-replay",
  sessionReplaySegment: "$session-replay-segment",
  refreshToken: "$refresh-token",
} as const;

export function toSpanId(prefix: string, rawId: string): string {
  return `${prefix}${rawId}`;
}

/**
 * The `parent_span_ids` an event insert stamps on each row — the full, deduped
 * list of ancestor spans the server can name, root-first: refresh-token, then the
 * session-replay span (via the server-resolved `session_replay_id`), then the
 * per-tab `$session-replay-segment` span (only when a replay exists, since that span
 * is written under a replay). Parent links are logical ancestry, not FK-guaranteed
 * rows; the list always contains a higher-level ancestor even if the segment span was
 * never written (recording off). The per-tab id is carried in `session_replay_segment_id`.
 */
export function buildEventSpanFields(opts: {
  sessionReplayId?: string | null,
  sessionReplaySegmentId?: string | null,
  refreshTokenId?: string | null,
}): { parent_span_ids: string[] } {
  const parentSpanIds: string[] = [];
  if (opts.refreshTokenId) {
    parentSpanIds.push(toSpanId(SPAN_ID_PREFIXES.refreshToken, opts.refreshTokenId));
  }
  if (opts.sessionReplayId) {
    parentSpanIds.push(toSpanId(SPAN_ID_PREFIXES.sessionReplay, opts.sessionReplayId));
  }
  if (opts.sessionReplayId && opts.sessionReplaySegmentId) {
    parentSpanIds.push(toSpanId(SPAN_ID_PREFIXES.sessionReplaySegment, opts.sessionReplaySegmentId));
  }
  return { parent_span_ids: parentSpanIds };
}

/**
 * One row of `analytics_internal.spans`. `created_at` is omitted (the table
 * defaults it to now64(3) = ingested-at). `version` is the span's own end time as
 * epoch ms (see `insertSessionReplaySpans`): the ReplacingMergeTree keeps the
 * highest version, so the row carrying the LATEST `span_ended_at` wins regardless
 * of insert order. Tying the version to the data (not wall-clock) means a stale or
 * partial re-write with an earlier end can never overwrite a later one — the span
 * end advances monotonically and never regresses under concurrent batches.
 */
export type SpanInsertRow = {
  id: string,
  span_type: string,
  span_started_at: Date,
  span_ended_at: Date | null,
  parent_span_ids: string[],
  data: string,
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: string | null,
  refresh_token_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  version: number,
};

export async function insertSpans(client: ClickHouseClient, rows: SpanInsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  await client.insert({
    table: "analytics_internal.spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
    },
  });
}

/**
 * One custom span as it arrives on the wire from the SDK (inside the analytics
 * events batch). Ids are raw uuids; `parent_span_ids` is the client's CUSTOM
 * ancestor chain only (root-first) — system ancestry is composed server-side.
 */
export type CustomSpanWireItem = {
  span_id: string,
  span_type: string,
  started_at_ms: number,
  ended_at_ms: number | null,
  parent_span_ids: string[],
  data: unknown,
  updated_at_ms: number,
};

// How far into the future a client-supplied `updated_at_ms` may run before we
// clamp it. A skewed clock only corrupts ordering among that user's own span
// re-writes; the clamp just bounds how long a bogus future version could mask
// legitimate later updates.
const CUSTOM_SPAN_VERSION_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Builds `analytics_internal.spans` rows for SDK-created custom spans. Each
 * row's `parent_span_ids` is the server-known system ancestry (same gating as
 * event rows — see `buildEventSpanFields`) followed by the client's custom
 * chain, every custom id prefixed `cs-`. The version is the client's
 * `updated_at_ms` — per-span monotonic by SDK construction, so the row carrying
 * the latest update wins in the ReplacingMergeTree regardless of insert order
 * (an end row can never be shadowed by a late-arriving open row). The replay
 * spans' end-time-as-version scheme is unusable here: two data re-writes while
 * the span is still open would collide at the same version.
 */
export function buildCustomSpanRows(opts: {
  spans: CustomSpanWireItem[],
  projectId: string,
  branchId: string,
  userId: string | null,
  refreshTokenId: string | null,
  sessionReplayId: string | null,
  sessionReplaySegmentId: string | null,
  serverNowMs: number,
}): SpanInsertRow[] {
  const systemAncestry = buildEventSpanFields({
    sessionReplayId: opts.sessionReplayId,
    sessionReplaySegmentId: opts.sessionReplaySegmentId,
    refreshTokenId: opts.refreshTokenId,
  }).parent_span_ids;

  return opts.spans.map((span) => {
    // The route schema is the primary gate; this backstop keeps the invariant
    // even for future callers: `$…` span types are reserved for system spans
    // and must never be writable through the custom-span path.
    if (span.span_type.startsWith("$")) {
      throw new HexclaveAssertionError(`Custom span types must not start with "$". Received: ${JSON.stringify(span.span_type)}`);
    }
    return {
      id: toSpanId(SPAN_ID_PREFIXES.custom, span.span_id),
      span_type: span.span_type,
      span_started_at: new Date(span.started_at_ms),
      span_ended_at: span.ended_at_ms == null ? null : new Date(span.ended_at_ms),
      parent_span_ids: [
        ...systemAncestry,
        ...span.parent_span_ids.map((id) => toSpanId(SPAN_ID_PREFIXES.custom, id)),
      ],
      data: JSON.stringify(stripLoneSurrogates(span.data)),
      project_id: opts.projectId,
      branch_id: opts.branchId,
      user_id: opts.userId,
      team_id: null,
      refresh_token_id: opts.refreshTokenId,
      session_replay_id: opts.sessionReplayId,
      session_replay_segment_id: opts.sessionReplaySegmentId,
      version: Math.min(Math.max(span.updated_at_ms, 1), opts.serverNowMs + CUSTOM_SPAN_VERSION_MAX_FUTURE_MS),
    };
  });
}

/**
 * Emits the two spans that describe a session replay from the replay batch route:
 * the replay-level `$session-replay` span and the per-tab `$session-replay-segment`
 * span. Re-written on every batch with the latest bounds so their `span_ended_at`
 * advances as recording continues. Each span's `version` is its own `span_ended_at`
 * (epoch ms), so the ReplacingMergeTree keeps the row with the latest end — the end
 * never regresses even if batches insert out of order or a re-write raced on a
 * partial view of the chunks (which self-heals on the next batch). The segment span
 * uses the RECORDING's `sessionReplaySegmentId` — the per-tab id — as its identity.
 */
export async function insertSessionReplaySpans(
  client: ClickHouseClient,
  opts: {
    projectId: string,
    branchId: string,
    replayId: string,
    sessionReplaySegmentId: string,
    projectUserId: string,
    refreshTokenId: string,
    replayStartedAt: Date,
    replayLastEventAt: Date,
    segmentStartedAt: Date,
    segmentLastEventAt: Date,
  },
): Promise<void> {
  const base = {
    data: "{}",
    project_id: opts.projectId,
    branch_id: opts.branchId,
    user_id: opts.projectUserId,
    team_id: null,
    refresh_token_id: opts.refreshTokenId,
    session_replay_id: opts.replayId,
  } as const;

  const replaySpan: SpanInsertRow = {
    ...base,
    id: toSpanId(SPAN_ID_PREFIXES.sessionReplay, opts.replayId),
    span_type: SPAN_TYPES.sessionReplay,
    span_started_at: opts.replayStartedAt,
    span_ended_at: opts.replayLastEventAt,
    parent_span_ids: [toSpanId(SPAN_ID_PREFIXES.refreshToken, opts.refreshTokenId)],
    session_replay_segment_id: null,
    version: opts.replayLastEventAt.getTime(),
  };

  const segmentSpan: SpanInsertRow = {
    ...base,
    id: toSpanId(SPAN_ID_PREFIXES.sessionReplaySegment, opts.sessionReplaySegmentId),
    span_type: SPAN_TYPES.sessionReplaySegment,
    span_started_at: opts.segmentStartedAt,
    span_ended_at: opts.segmentLastEventAt,
    parent_span_ids: [
      toSpanId(SPAN_ID_PREFIXES.refreshToken, opts.refreshTokenId),
      toSpanId(SPAN_ID_PREFIXES.sessionReplay, opts.replayId),
    ],
    session_replay_segment_id: opts.sessionReplaySegmentId,
    version: opts.segmentLastEventAt.getTime(),
  };

  await insertSpans(client, [replaySpan, segmentSpan]);
}
