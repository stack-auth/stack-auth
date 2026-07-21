import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { CLIENT_SYSTEM_SPAN_TYPES, PAGE_VIEW_SPAN_TYPE } from "@hexclave/shared/dist/utils/telemetry";
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
  // User-defined spans created via the SDK's startSpan(). Applied server-side to
  // the client-generated raw uuid and to every id inside a client-supplied parent
  // chain — clients only ever transmit raw custom uuids, never prefixed ids.
  custom: "cs-",
  // The client-minted `$page-view` span (one per navigation per tab). Gets its
  // own prefix rather than sharing `sas-` because page-view ids are referenced
  // from OTHER rows' parent_span_ids (via the per-item `page_view_span_id` wire
  // field), so the parent array stays self-describing about which ancestor is
  // the page.
  pageView: "pv-",
  // Client-minted system autocapture spans other than `$page-view` ($tab-hidden,
  // $window-blur, $offline). These are never referenced as parents by other
  // rows, so one shared prefix is enough — the span row's own span_type carries
  // the distinction.
  systemAutocapture: "sas-",
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
 * Session replay segment ids are stable for the lifetime of a browser tab, while
 * the backend may roll that tab into multiple replays after idle/max-duration
 * boundaries. Include both ids so a later replay cannot replace the earlier
 * replay's segment row in ClickHouse.
 */
export function toSessionReplaySegmentSpanId(replayId: string, sessionReplaySegmentId: string): PrefixedSpanId {
  return toSpanId(SPAN_ID_PREFIXES.sessionReplaySegment, `${replayId}:${sessionReplaySegmentId}`);
}

/**
 * The `parent_span_ids` an event insert stamps on each row — the full, deduped
 * list of ancestor spans the server can name, root-first: refresh-token, then the
 * session-replay span (via the server-resolved `session_replay_id`), then the
 * per-tab `$session-replay-segment` span.
 *
 * The segment id is included whenever the client sent one, even if we have not
 * yet resolved `session_replay_id`. Event batches and replay batches flush on
 * independent timers; the client mints `session_replay_segment_id` at tab start,
 * so an early `$page-view` can land before `findRecentSessionReplay` sees a row.
 * Parent links are logical ancestry, not FK-guaranteed — stamping `srsi-…` here
 * lets the Traces UI attach that event to the segment span once the first replay
 * batch writes it. Omitting it left those events parented only under
 * `$refresh-token`, which often falls outside the Traces time window (token
 * `created_at` can be days old), so `$page-view`/`$click` looked "missing".
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
    parentSpanIds.push(toSessionReplaySegmentSpanId(opts.sessionReplayId, opts.sessionReplaySegmentId));
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
 * One span as it arrives on the wire from the SDK (inside the analytics events
 * batch): either a user-defined custom span or a client-minted system
 * autocapture span (`CLIENT_SYSTEM_SPAN_TYPES`). Ids are raw uuids;
 * `parent_span_ids` is the client's CUSTOM ancestor chain only (root-first) —
 * system ancestry (refresh-token/replay/segment/page-view) is composed
 * server-side. `page_view_span_id` names the `$page-view` span the item
 * happened on; it is client tab state the server cannot derive, so it rides
 * per-item (a batch can straddle a navigation).
 */
export type BatchSpanWireItem = {
  span_id: string,
  span_type: string,
  started_at_ms: number,
  ended_at_ms: number | null,
  parent_span_ids: string[],
  data: unknown,
  updated_at_ms: number,
  page_view_span_id?: string | null,
};

/**
 * The id prefix a wire span's own row id gets, by type. The `$page-view` /
 * autocapture distinction matters (see SPAN_ID_PREFIXES); any other `$` type is
 * unreachable here (the route schema rejects it) and asserts as a backstop.
 */
export function wireSpanIdPrefix(spanType: string): SpanIdPrefix {
  if (spanType === PAGE_VIEW_SPAN_TYPE) return SPAN_ID_PREFIXES.pageView;
  if ((CLIENT_SYSTEM_SPAN_TYPES as readonly string[]).includes(spanType)) return SPAN_ID_PREFIXES.systemAutocapture;
  if (spanType.startsWith("$")) {
    throw new HexclaveAssertionError(`Span type ${JSON.stringify(spanType)} is not a writable system span type and not a valid custom type. The route schema should have rejected it.`);
  }
  return SPAN_ID_PREFIXES.custom;
}

// How far into the future a client-supplied `updated_at_ms` may run before we
// clamp it. A skewed clock only corrupts ordering among that user's own span
// re-writes; the clamp just bounds how long a bogus future version could mask
// legitimate later updates.
const CUSTOM_SPAN_VERSION_MAX_FUTURE_MS = 5 * 60 * 1000;

/**
 * Version builder for SDK-created custom spans: the client's `updated_at_ms`,
 * clamped to [1, serverNow + 5min]. Custom spans re-write their `data` while
 * still open, so `monotoneEndSpanVersion` is unusable here — two data re-writes
 * of an open span would collide at the same (null-end-derived) version. The SDK
 * bumps `updated_at_ms` on every mutation, making it per-span monotonic, so the
 * latest client-side state wins in the ReplacingMergeTree regardless of insert
 * order. See `monotoneEndSpanVersion` for the one-table-many-schemes warning.
 */
export function clientUpdatedAtSpanVersion(updatedAtMs: number, serverNowMs: number): number {
  return Math.min(Math.max(updatedAtMs, 1), serverNowMs + CUSTOM_SPAN_VERSION_MAX_FUTURE_MS);
}

/**
 * Builds `analytics_internal.spans` rows for SDK-sent wire spans (custom spans
 * and client-minted system autocapture spans). Each row's `parent_span_ids` is
 * the server-known system ancestry (same gating as event rows — see
 * `buildEventSpanFields`), then the item's `$page-view` ancestor (`pv-`) when
 * the client named one, then the client's custom chain, every custom id
 * prefixed `cs-`. The version is the client's `updated_at_ms` — per-span
 * monotonic by SDK construction, so the row carrying the latest update wins in
 * the ReplacingMergeTree regardless of insert order (an end row can never be
 * shadowed by a late-arriving open row). The replay spans' end-time-as-version
 * scheme is unusable here: two data re-writes while the span is still open
 * would collide at the same version.
 */
export function buildBatchSpanRows(opts: {
  spans: BatchSpanWireItem[],
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
    // wireSpanIdPrefix asserts on `$` types outside CLIENT_SYSTEM_SPAN_TYPES
    // (the route schema is the primary gate; this keeps the invariant for any
    // future caller). Server-derived span types can never be written here.
    const idPrefix = wireSpanIdPrefix(span.span_type);
    // A `$page-view` span IS the page — parenting one page-view under another
    // would make the hierarchy lie. The route schema rejects this; assert so a
    // future non-route caller cannot reintroduce it.
    if (span.span_type === PAGE_VIEW_SPAN_TYPE && span.page_view_span_id != null) {
      throw new HexclaveAssertionError("A $page-view span must not itself carry a page_view_span_id");
    }
    if (span.page_view_span_id != null && span.page_view_span_id === span.span_id) {
      throw new HexclaveAssertionError("A span must not name itself as its page_view_span_id");
    }
    return {
      id: toSpanId(idPrefix, span.span_id),
      span_type: span.span_type,
      span_started_at: new Date(span.started_at_ms),
      span_ended_at: span.ended_at_ms == null ? null : new Date(span.ended_at_ms),
      parent_span_ids: [
        ...systemAncestry,
        ...span.page_view_span_id != null ? [toSpanId(SPAN_ID_PREFIXES.pageView, span.page_view_span_id)] : [],
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
      version: clientUpdatedAtSpanVersion(span.updated_at_ms, opts.serverNowMs),
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
 * uses the replay id plus the recording's per-tab id as its identity.
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
    id: toSessionReplaySegmentSpanId(opts.replayId, opts.sessionReplaySegmentId),
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
