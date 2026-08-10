import type { IssueFrame } from "./issues-data";

/**
 * How an Issue is named and described in the UI.
 *
 * All pure, all tested: these three functions decide what a triager reads
 * first, and every one of them has a degenerate input that the obvious
 * implementation gets subtly wrong.
 */

const UNKNOWN_ISSUE_TITLE = "Unknown error";
const UNKNOWN_ISSUE_CULPRIT = "unknown";

function firstLine(value: string): string {
  return (value.split("\n", 1)[0] ?? "").trim();
}

export type IssueTitleInput = {
  type: string,
  value: string,
  synthetic: boolean,
};

/**
 * The bold half of the issue cell.
 *
 * Normally the exception type (`TypeError`), which is what groups issues and
 * what a reader scans for. Synthetic errors are the exception, literally: the
 * SDK's `normalizeCapturedError` forces `name = "Error"` for every non-`Error`
 * throw, so `throw "nope"` and `throw { code: 42 }` both arrive as type
 * `"Error"`. Titling those on the type renders every non-Error throw in the
 * project identically and makes the list useless exactly where it matters most
 * — so they title on their message instead.
 */
export function issueTitle(issue: IssueTitleInput): string {
  const message = firstLine(issue.value);
  const type = issue.type.trim();
  if (issue.synthetic) return message || type || UNKNOWN_ISSUE_TITLE;
  return type || message || UNKNOWN_ISSUE_TITLE;
}

/**
 * The muted half. Empty when the message is already the title — repeating it
 * would spend the row's whole width saying one thing twice.
 */
export function issueSubtitle(issue: IssueTitleInput): string {
  const message = firstLine(issue.value);
  return message === issueTitle(issue) ? "" : message;
}

export type IssueCulpritInput = {
  /** The server-computed culprit. Empty string when grouping degraded. */
  culprit: string | null,
  /**
   * In the backend parser's storage order: **oldest frame first**, so the
   * innermost ("top") frame is the LAST element. Pass the frames as they came
   * off the wire, not the display-reversed copy the frame table renders.
   */
  frames?: readonly IssueFrame[],
  data?: Record<string, unknown> | null,
};

function frameCulprit(frame: IssueFrame): string | null {
  const location = frame.module ?? frame.filename ?? frame.abs_path;
  const fn = frame.function;
  if (location == null && fn == null) return null;
  if (location == null) return fn;
  if (fn == null) return location;
  return `${location} in ${fn}`;
}

function stringField(data: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * "Where did this happen" — the line under the title.
 *
 * Falls back through the whole chain rather than trusting any single source:
 * the server culprit is empty for degraded grouping, frames are empty for
 * errors thrown before a stack existed, and `data.url` is the only locator a
 * browser-side non-Error throw carries. **Never returns `""`** — an empty
 * culprit renders as a blank second line, which reads as a layout bug rather
 * than as missing data, so the terminal fallback is a visible word.
 */
export function issueCulprit(input: IssueCulpritInput): string {
  const explicit = input.culprit?.trim();
  if (explicit != null && explicit !== "") return explicit;

  const frames = input.frames ?? [];
  const topInApp = [...frames].reverse().find((frame) => frame.in_app);
  const fromInApp = topInApp == null ? null : frameCulprit(topInApp);
  if (fromInApp != null && fromInApp !== "") return fromInApp;

  const top = frames.at(-1);
  const fromTop = top == null ? null : frameCulprit(top);
  if (fromTop != null && fromTop !== "") return fromTop;

  return stringField(input.data, "url")
    ?? stringField(input.data, "path")
    ?? stringField(input.data, "mechanism_type")
    ?? UNKNOWN_ISSUE_CULPRIT;
}

/** `#42`. The copyable, quotable handle for an issue. */
export function issueShortIdLabel(shortId: string): string {
  return `#${shortId}`;
}

/**
 * Counts that may exceed `Number.MAX_SAFE_INTEGER`.
 *
 * Lifetime counters arrive as decimal strings because they are Postgres
 * `BigInt`s. Below 10k the exact digits matter (you compare two similar issues
 * by eye); above it only the magnitude does, and the compaction step converts
 * to `Number`, which is lossy past 2^53 — irrelevant when the output is
 * "9007199254.7M" either way.
 */
export function formatIssueCount(value: number | string): string {
  const asBigInt = typeof value === "string" ? parseDecimalStringOrThrow(value) : BigInt(Math.round(value));
  if (asBigInt < BigInt(0)) throw new Error(`Cannot format a negative issue count: ${value}`);
  if (asBigInt < BigInt(10_000)) return asBigInt.toLocaleString();
  const asNumber = Number(asBigInt);
  if (asNumber < 1_000_000) return `${(asNumber / 1_000).toFixed(asNumber < 100_000 ? 1 : 0)}k`;
  return `${(asNumber / 1_000_000).toFixed(asNumber < 10_000_000 ? 1 : 0)}M`;
}

function parseDecimalStringOrThrow(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Expected a decimal count string, got "${value}"`);
  return BigInt(value);
}

/**
 * Route-segment parsing for `issues/[issueId]`.
 *
 * The segment is either a uuid or an all-digits short id, and the backend
 * resolves both (falling through to `IssueRedirect` on a miss). Anything else
 * is a typo'd URL, which the page must report rather than send to the API.
 */
export type IssueRouteId = { kind: "uuid", value: string } | { kind: "short-id", value: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIssueRouteId(raw: string): IssueRouteId | null {
  const trimmed = raw.trim();
  if (UUID_PATTERN.test(trimmed)) return { kind: "uuid", value: trimmed.toLowerCase() };
  // Leading zeros would resolve to a different string than the id the API
  // minted, so they are a miss rather than a normalization opportunity.
  if (/^[1-9]\d*$/.test(trimmed)) return { kind: "short-id", value: trimmed };
  return null;
}
