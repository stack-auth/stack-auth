import yup from "yup";
import { yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString } from "../schema-fields";

// Single source of truth for the `/internal/issues*` endpoint shapes.
//
// Both the backend route handlers (`apps/backend/src/app/api/latest/internal/issues/**`)
// and the dashboard (`apps/dashboard/.../observability/issues/**`, via
// `sendInternalAdminRequest`) import these schemas, exactly like
// `admin-metrics.ts` does for `/internal/metrics`. Runtime validation lives in
// the schemas; static types are derived with `yup.InferType` so there is never
// a parallel copy to keep in sync.
//
// ── Why so many `yupString()` where you'd expect a number ──────────────────
// `Issue.shortId` and `Issue.timesSeen` are Postgres `BigInt`. The response
// pipeline in `apps/backend/src/route-handlers/smart-response.tsx` runs
// `JSON.stringify(body)` (twice — once to validate round-tripping, once to
// encode), and `JSON.stringify` THROWS on a BigInt rather than coercing it.
// So these cross the wire as decimal strings. Callers that need arithmetic
// should parse with `BigInt(...)`, not `Number(...)`, because `times_seen` on a
// firehose project can exceed `Number.MAX_SAFE_INTEGER`.

/** Stored lifecycle status. `substatus` below is derived, never stored. */
export const IssueStatusSchema = yupString().oneOf(["unresolved", "resolved", "ignored"]).defined();

/**
 * Derived from timestamps at read time relative to the requested window, never
 * persisted: an issue that is "new" in a 24h window is "ongoing" in a 30d one.
 */
export const IssueSubstatusSchema = yupString().oneOf(["new", "ongoing", "regressed"]).defined();

/**
 * A stack frame after server-side parsing. `context` is absent until source
 * maps land (it is filled by symbolication); the field exists in the contract
 * from day one so shipping source maps is a pure data change with no schema or
 * renderer rewrite.
 */
export const IssueFrameSchema = yupObject({
  filename: yupString().nullable().defined(),
  function: yupString().nullable().defined(),
  module: yupString().nullable().defined(),
  abs_path: yupString().nullable().defined(),
  lineno: yupNumber().nullable().defined(),
  colno: yupNumber().nullable().defined(),
  in_app: yupBoolean().defined(),
  debug_id: yupString().optional(),
  context: yupObject({
    line: yupString().defined(),
    pre: yupArray(yupString().defined()).defined(),
    post: yupArray(yupString().defined()).defined(),
    symbolicated: yupBoolean().defined(),
  }).optional(),
}).defined();

export const IssueListItemSchema = yupObject({
  id: yupString().defined(),
  /** Per-tenancy (project AND branch) monotonic counter, as a decimal string. */
  short_id: yupString().defined(),

  // Display identity, denormalized from the occurrence that CREATED the issue
  // and never rewritten — the title must not shift under the user because a
  // later occurrence happened to carry a different message.
  type: yupString().defined(),
  value: yupString().defined(),
  culprit: yupString().defined(),
  level: yupString().defined(),

  status: IssueStatusSchema,
  substatus: IssueSubstatusSchema,

  // ── Lifetime, from Postgres ──
  // Maintained exclusively by ledger-applied deltas (see IssueMaterialization).
  // Never reconstructed from ClickHouse: the rollup retains 90 days, so it
  // cannot answer an all-time question.
  first_seen_at_millis: yupNumber().defined(),
  last_seen_at_millis: yupNumber().defined(),
  times_seen: yupString().defined(),
  /**
   * Non-null when an unmerge seeded this issue's lifetime counters from the
   * retained window rather than from true all-time data. The UI must render
   * "N events since <date>" instead of an all-time number it cannot back up.
   */
  counters_truncated_at_millis: yupNumber().nullable().defined(),

  // ── Window-scoped, from the ClickHouse rollup ──
  // These answer "in the selected time range", and are deliberately named
  // differently from the lifetime fields above because the two look
  // interchangeable in a table and are not.
  window_occurrences: yupNumber().defined(),
  window_users: yupNumber().defined(),

  service_name: yupString().nullable().defined(),
  environment: yupString().nullable().defined(),
  release: yupString().nullable().defined(),
  handled: yupBoolean().defined(),
  synthetic: yupBoolean().defined(),

  /**
   * Lets the dashboard reconcile an optimistic status override: the override is
   * dropped once the server returns a row newer than the one it was applied to.
   * A permanent override would mask a later automatic regression of the same
   * issue.
   */
  updated_at_millis: yupNumber().defined(),

  /**
   * Every hash this issue owns. The dashboard needs them to batch one sparkline
   * query for a whole page (`WHERE issue_hash IN (...)`) instead of one query
   * per row.
   */
  issue_hashes: yupArray(yupString().defined()).defined(),
}).defined();

export const IssueListResponseSchema = yupObject({
  items: yupArray(IssueListItemSchema).defined(),
  /** Opaque keyset cursor; `null` when there is no further page. */
  cursor: yupString().nullable().defined(),
  counts: yupObject({
    unresolved: yupNumber().defined(),
    resolved: yupNumber().defined(),
    ignored: yupNumber().defined(),
  }).defined(),
  /**
   * True when the candidate set exceeded `ISSUE_RANK_CANDIDATE_CAP` and the
   * ranking is therefore over a bounded subset. Surfaced in the UI rather than
   * silently truncated — "the top 1000 issues" and "a correct ranking over a
   * declared candidate set" are different claims and only one of them is honest.
   */
  approximate: yupBoolean().defined(),
}).defined();

/** One `$error` row, resolved for the detail view. */
export const IssueOccurrenceSchema = yupObject({
  occurrence_id: yupString().defined(),
  event_at_millis: yupNumber().defined(),
  message: yupString().defined(),
  level: yupString().defined(),
  /** The flat `$error` payload, minus the fields promoted to columns. */
  data: yupMixed().defined(),
  frames: yupArray(IssueFrameSchema).defined(),
  /** Raw stack, kept so the UI can degrade to it when parsing produced nothing. */
  raw_stack: yupString().nullable().defined(),

  trace_id: yupString().nullable().defined(),
  span_id: yupString().nullable().defined(),
  page_view_span_id: yupString().nullable().defined(),
  session_replay_id: yupString().nullable().defined(),
  user_id: yupString().nullable().defined(),

  service_name: yupString().nullable().defined(),
  environment: yupString().nullable().defined(),
  release: yupString().nullable().defined(),
}).defined();

export const IssueDetailResponseSchema = yupObject({
  issue: IssueListItemSchema,
  /** `null` only when every occurrence has aged out past the telemetry TTL. */
  occurrence: IssueOccurrenceSchema.nullable().defined(),
  /** Keyset cursors for occurrence navigation, over `(event_at, occurrence_id)`. */
  newer_cursor: yupString().nullable().defined(),
  older_cursor: yupString().nullable().defined(),
  /**
   * Set when the requested id resolved through an `IssueRedirect` (i.e. the
   * issue was merged away). The dashboard rewrites the URL so the next copy
   * carries the surviving id.
   */
  redirected_from_issue_id: yupString().nullable().defined(),
}).defined();

export const IssueUpdateRequestSchema = yupObject({
  status: IssueStatusSchema,
  /**
   * Only meaningful with `status: "ignored"`. Null/absent means ignore forever.
   * An ignored issue whose snooze has expired wakes up on its next occurrence —
   * there is deliberately no cron for this, because an ignored issue that never
   * recurs *should* stay ignored.
   */
  ignored_until_millis: yupNumber().nullable().optional(),
}).defined();

export const IssueMergeRequestSchema = yupObject({
  /**
   * Two or more issues to merge. The primary is chosen by
   * `(firstSeenAt asc, timesSeen desc, id asc)` — Sentry's rule — rather than
   * by the caller, so the outcome is deterministic and the oldest issue (which
   * carries the most history and the most inbound links) survives.
   */
  issue_ids: yupArray(yupString().defined()).min(2).defined(),
}).defined();

export const IssueUnmergeRequestSchema = yupObject({
  /**
   * Hashes to split out into a new issue. Must be a strict subset of the
   * source issue's owned hashes — splitting all of them is a no-op, and
   * splitting none is an error.
   */
  hashes: yupArray(yupString().defined()).min(1).defined(),
}).defined();

export const IssueMergeResponseSchema = yupObject({
  primary_issue_id: yupString().defined(),
  merged_issue_ids: yupArray(yupString().defined()).defined(),
}).defined();

export const IssueUnmergeResponseSchema = yupObject({
  source_issue_id: yupString().defined(),
  new_issue_id: yupString().defined(),
  /**
   * Echoes that the new issue's lifetime counters were seeded from the retained
   * window, because lifetime counts genuinely cannot be split — the rollup only
   * goes back 90 days.
   */
  counters_truncated_at_millis: yupNumber().defined(),
}).defined();

export type IssueStatus = yup.InferType<typeof IssueStatusSchema>;
export type IssueSubstatus = yup.InferType<typeof IssueSubstatusSchema>;
export type IssueFrame = yup.InferType<typeof IssueFrameSchema>;
export type IssueListItem = yup.InferType<typeof IssueListItemSchema>;
export type IssueListResponse = yup.InferType<typeof IssueListResponseSchema>;
export type IssueOccurrence = yup.InferType<typeof IssueOccurrenceSchema>;
export type IssueDetailResponse = yup.InferType<typeof IssueDetailResponseSchema>;
export type IssueUpdateRequest = yup.InferType<typeof IssueUpdateRequestSchema>;
export type IssueMergeRequest = yup.InferType<typeof IssueMergeRequestSchema>;
export type IssueUnmergeRequest = yup.InferType<typeof IssueUnmergeRequestSchema>;
export type IssueMergeResponse = yup.InferType<typeof IssueMergeResponseSchema>;
export type IssueUnmergeResponse = yup.InferType<typeof IssueUnmergeResponseSchema>;

export const ISSUE_LIST_SORT_FIELDS = ["last_seen", "first_seen", "events", "users"] as const;
export type IssueListSortField = (typeof ISSUE_LIST_SORT_FIELDS)[number];

/**
 * `events` and `users` are window-scoped, so ClickHouse has to do the ranking;
 * the other two are lifetime and are served straight off a Postgres index.
 * This split is what decides which of the two query paths a request takes.
 */
export const CLICKHOUSE_RANKED_SORT_FIELDS: readonly IssueListSortField[] = ["events", "users"];

export const ISSUE_LIST_PAGE_SIZE = 50;

/**
 * Upper bound on how many status-filtered candidate issues we will hand to
 * ClickHouse for window-scoped ranking. Beyond this the response sets
 * `approximate: true`.
 *
 * The alternative — mirroring `Issue.status` into ClickHouse so the whole query
 * is one statement — removes the bound but creates a second source of truth for
 * a user-mutable field. A stale mirror showing a resolved issue as unresolved
 * is exactly the bug that makes people stop trusting an error tracker, so we
 * take the bound instead and say so out loud.
 */
export const ISSUE_RANK_CANDIDATE_CAP = 5000;
