import type { ClickHouseClient } from "./clickhouse";

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
// which stay raw so existing customer SQL keeps working. Only prefixes with an
// actual writer belong here — add new ones together with the code that writes them.
export const SPAN_ID_PREFIXES = {
  sessionReplay: "sri-",
  // The per-tab id. The SDK mints exactly one `session_replay_segment_id` per
  // browser tab, so despite the "segment" name it IS the per-tab id — there is
  // only this one level (there is no separate "tab"). Named "segment" to stay
  // consistent with the pre-existing `session_replay_segment_id` column + SDK field.
  sessionReplaySegment: "srsi-",
  refreshToken: "rti-",
} as const;

export type SpanIdPrefix = typeof SPAN_ID_PREFIXES[keyof typeof SPAN_ID_PREFIXES];
export type PrefixedSpanId = `${SpanIdPrefix}${string}`;

export const SPAN_TYPES = {
  sessionReplay: "$session-replay",
  sessionReplaySegment: "$session-replay-segment",
  refreshToken: "$refresh-token",
} as const;

// The prefix parameter is constrained to the known prefixes (not `string`) so a
// call site can't accidentally double-prefix (`toSpanId(prefix, alreadyPrefixed)`
// still type-checks on the rawId — but passing a PrefixedSpanId where a raw uuid
// is expected is the caller's bug; constraining the prefix at least rules out
// arbitrary/misspelled prefixes and prefix-of-a-prefix mistakes).
export function toSpanId<P extends SpanIdPrefix>(prefix: P, rawId: string): `${P}${string}` {
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
}): { parent_span_ids: PrefixedSpanId[] } {
  const parentSpanIds: PrefixedSpanId[] = [];
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
 * defaults it to now64(3) = ingested-at). `version` decides which row the
 * ReplacingMergeTree keeps per id (highest wins) and MUST come from one of the
 * named version builders in this file (e.g. `monotoneEndSpanVersion`) — see the
 * builder docs for why the scheme is per-span-type and must never be inlined.
 */
export type SpanInsertRow = {
  id: PrefixedSpanId,
  span_type: string,
  span_started_at: Date,
  span_ended_at: Date | null,
  parent_span_ids: PrefixedSpanId[],
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

/**
 * Version builder for spans whose end time only ever advances (session-replay and
 * segment spans: bounds are min/max aggregates, so a later batch can only extend
 * them). The version IS the span's own end (epoch ms), so the row carrying the
 * LATEST `span_ended_at` wins in the ReplacingMergeTree regardless of insert
 * order — a stale or partial re-write with an earlier end can never overwrite a
 * later one.
 *
 * IMPORTANT: `analytics_internal.spans` is one table but not one versioning
 * scheme. Every writer MUST version through one of the named builders in this
 * file (never inline math), because mixing schemes for the same span id silently
 * corrupts upserts. Use this builder only for spans whose end is monotone; spans
 * that need data re-writes without the end moving (e.g. custom spans) need a
 * different scheme with its own builder.
 */
export function monotoneEndSpanVersion(spanEndedAt: Date): number {
  return spanEndedAt.getTime();
}

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
    version: monotoneEndSpanVersion(opts.replayLastEventAt),
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
    version: monotoneEndSpanVersion(opts.segmentLastEventAt),
  };

  await insertSpans(client, [replaySpan, segmentSpan]);
}
