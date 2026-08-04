import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import type { IssueOccurrence } from "./issues-data";

/**
 * "Leading up to this" — the log lines immediately before an error occurrence.
 *
 * The hard part is deciding *what* "the same session" means, because an
 * occurrence may carry any subset of three correlation ids and they have
 * different reach:
 *
 *   trace_id           tightest: the same request/operation.
 *   page_view_span_id  the same page view — wider, but still one user action.
 *   session_replay_id  the whole recorded session — widest, and the only one a
 *                      browser error thrown outside any traced work will have.
 *
 * The chain is ordered narrowest-first so the log excerpt is as relevant as the
 * data allows, and it is a single exported function rather than an inline
 * ternary in the component precisely so it can be unit-tested — the "which id
 * do we use" decision is the whole feature.
 */

export const LEADING_UP_TO_WINDOW_MS = 5 * 60_000;
export const LEADING_UP_TO_LIMIT = 50;

export type CorrelationAnchorKind = "trace" | "page_view_span" | "session_replay";

export type CorrelationAnchor = { kind: CorrelationAnchorKind, value: string };

/**
 * The ClickHouse column each anchor kind filters on. A fixed map, so the column
 * name in the SQL below can never come from data.
 */
const ANCHOR_COLUMNS = new Map<CorrelationAnchorKind, string>([
  ["trace", "trace_id"],
  ["page_view_span", "page_view_span_id"],
  ["session_replay", "session_replay_id"],
]);

export const CORRELATION_ANCHOR_LABELS = new Map<CorrelationAnchorKind, string>([
  ["trace", "same trace"],
  ["page_view_span", "same page view"],
  ["session_replay", "same session"],
]);

function nonEmpty(value: string | null): string | null {
  return value != null && value.trim() !== "" ? value : null;
}

export function resolveCorrelationAnchor(
  occurrence: Pick<IssueOccurrence, "trace_id" | "page_view_span_id" | "session_replay_id">,
): CorrelationAnchor | null {
  const traceId = nonEmpty(occurrence.trace_id);
  if (traceId != null) return { kind: "trace", value: traceId };
  const pageViewSpanId = nonEmpty(occurrence.page_view_span_id);
  if (pageViewSpanId != null) return { kind: "page_view_span", value: pageViewSpanId };
  const sessionReplayId = nonEmpty(occurrence.session_replay_id);
  if (sessionReplayId != null) return { kind: "session_replay", value: sessionReplayId };
  return null;
}

/**
 * The 50 most recent `$log` lines in the five minutes before (and including)
 * the occurrence.
 *
 * Both the anchor value and the time bounds ride as bound parameters: the
 * anchor is customer-influenced (a trace id can be propagated in from a client
 * header), so interpolating it would be an injection surface, and the bounds
 * are bound for symmetry rather than out of necessity.
 */
export function getLeadingUpToLogsQuery(
  anchor: CorrelationAnchor,
  occurrenceAtMillis: number,
): { query: string, params: Record<string, string | number> } {
  const column = ANCHOR_COLUMNS.get(anchor.kind);
  if (column == null) {
    throw new HexclaveAssertionError(`Unknown correlation anchor kind: ${anchor.kind}`);
  }
  if (!Number.isFinite(occurrenceAtMillis)) {
    throw new HexclaveAssertionError(`Occurrence timestamp must be finite, got ${occurrenceAtMillis}`);
  }
  return {
    query: `
SELECT
  event_at,
  level,
  message,
  service_name
FROM default.logs
WHERE ${column} = {anchorValue:String}
  AND event_at >= fromUnixTimestamp64Milli({fromMillis:Int64}, 'UTC')
  AND event_at <= fromUnixTimestamp64Milli({toMillis:Int64}, 'UTC')
ORDER BY event_at DESC
LIMIT ${LEADING_UP_TO_LIMIT}
`,
    params: {
      anchorValue: anchor.value,
      fromMillis: occurrenceAtMillis - LEADING_UP_TO_WINDOW_MS,
      toMillis: occurrenceAtMillis,
    },
  };
}

export type LeadingUpToLogLine = {
  eventAtMillis: number,
  level: string,
  message: string,
  serviceName: string | null,
};

export function parseLeadingUpToLogRows(
  rows: readonly Record<string, unknown>[],
): LeadingUpToLogLine[] {
  return rows.map((row) => {
    const rawEventAt = row.event_at;
    if (typeof rawEventAt !== "string") {
      throw new HexclaveAssertionError("Expected log row event_at to be a ClickHouse timestamp string");
    }
    const trimmed = rawEventAt.trim();
    const normalized = trimmed.replace(" ", "T") + (trimmed.includes("Z") || trimmed.includes("+") ? "" : "Z");
    const eventAtMillis = new Date(normalized).getTime();
    if (Number.isNaN(eventAtMillis)) {
      throw new HexclaveAssertionError(`Invalid log row event_at: ${rawEventAt}`);
    }
    return {
      eventAtMillis,
      level: typeof row.level === "string" ? row.level : "",
      message: typeof row.message === "string" ? row.message : "",
      serviceName: typeof row.service_name === "string" && row.service_name !== "" ? row.service_name : null,
    };
    // Rows are returned newest-first by the query; the caller reverses them so
    // the excerpt reads forward in time, ending at the error.
  });
}
