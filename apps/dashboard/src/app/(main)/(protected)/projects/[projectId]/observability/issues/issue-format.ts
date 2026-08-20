import { formatCount } from "../format";
import type { IssueFrame } from "./issues-data";


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

export function issueTitle(issue: IssueTitleInput): string {
  const message = firstLine(issue.value);
  const type = issue.type.trim();
  if (issue.synthetic) return message || type || UNKNOWN_ISSUE_TITLE;
  return type || message || UNKNOWN_ISSUE_TITLE;
}

export function issueSubtitle(issue: IssueTitleInput): string {
  const message = firstLine(issue.value);
  return message === issueTitle(issue) ? "" : message;
}

export type IssueCulpritInput = {
  culprit: string | null,
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

const SERVER_UNKNOWN_CULPRIT_SENTINEL = "<unknown>";


export function issueCulprit(input: IssueCulpritInput): string {
  const explicit = input.culprit?.trim();
  if (explicit != null && explicit !== "" && explicit !== SERVER_UNKNOWN_CULPRIT_SENTINEL) return explicit;

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

export function issueShortIdLabel(shortId: string): string {
  return `#${shortId}`;
}

export function formatIssueCount(value: number | string): string {
  const asBigInt = typeof value === "string" ? parseDecimalStringOrThrow(value) : BigInt(Math.round(value));
  return formatCount(Number(asBigInt));
}

function parseDecimalStringOrThrow(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Expected a decimal count string, got "${value}"`);
  return BigInt(value);
}

export type IssueRouteId = { kind: "uuid", value: string } | { kind: "short-id", value: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseIssueRouteId(raw: string): IssueRouteId | null {
  const trimmed = raw.trim();
  if (UUID_PATTERN.test(trimmed)) return { kind: "uuid", value: trimmed.toLowerCase() };
  if (/^[1-9]\d*$/.test(trimmed)) return { kind: "short-id", value: trimmed };
  return null;
}
