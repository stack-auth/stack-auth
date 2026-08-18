import { createHash } from "node:crypto";
import type { IssueBatchApplyOutcome } from "../issue-store";
import type { IssueBatchDelta } from "../issue-materialization-contract";
import { scrubErrorIngestPayload } from "@/lib/error-ingest";
import type { IssueAlertLevel, IssueAlertScalar, IssueAlertSignal, IssueAlertStatus } from "./types";

const MAX_SIGNAL_MAP_ENTRIES = 100;
const MAX_SIGNAL_KEY_BYTES = 256;
const MAX_SIGNAL_STRING_BYTES = 8 * 1024;

type LoadedIssueStatus = "UNRESOLVED" | "RESOLVED" | "IGNORED";

function normalizeIssueAlertLevel(value: string): IssueAlertLevel | undefined {
  switch (value) {
    case "trace":
    case "debug":
    case "info":
    case "warn":
    case "error": {
      return value;
    }
    case "warning": { return "warn"; }
    case "fatal": { return "error"; }
    default: {
      // A malformed legacy level must not make otherwise valid issue
      // materialization fail; it simply cannot satisfy a level predicate.
      return undefined;
    }
  }
}

export type IssueAlertIssueSnapshot = {
  id: string,
  shortId: bigint,
  type: string,
  value: string,
  culprit: string,
  status: LoadedIssueStatus,
};

export type IssueAlertSignalInput = {
  scope: Pick<IssueAlertSignal, "tenancyId" | "projectId" | "branchId">,
  outcome: IssueBatchApplyOutcome,
  input: IssueBatchDelta,
  issue: IssueAlertIssueSnapshot,
  errorEnvelope?: unknown,
  frequencyCounts?: ReadonlyMap<number, number>,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): value is IssueAlertScalar {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function boundedKey(value: string): string | null {
  const bytes = new TextEncoder().encode(value).byteLength;
  return value.length > 0 && bytes <= MAX_SIGNAL_KEY_BYTES ? value : null;
}

// Mirrors the evaluator's SAFE_TEXT_PATTERN: its `validateSignal` rejects the
// WHOLE signal when any identifier contains a control character or exceeds
// 256 bytes.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/**
 * Release/environment come from customer telemetry with no upstream bound
 * tight enough for the evaluator's 256-byte identifier limit. They must be
 * normalized to null HERE rather than handed through verbatim: an oversized
 * (or control-character) release would fail `validateSignal` and silently
 * suppress EVERY alert for the occurrence, when the honest outcome is "this
 * occurrence has no usable release" — release/environment predicates then
 * simply cannot match, and everything else still alerts.
 */
function boundedIdentifierOrNull(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  if (CONTROL_CHARACTER_PATTERN.test(value)) return null;
  return new TextEncoder().encode(value).byteLength <= MAX_SIGNAL_KEY_BYTES ? value : null;
}

function boundedString(value: string): string | null {
  const bytes = new TextEncoder().encode(value).byteLength;
  return value.length > 0 && bytes <= MAX_SIGNAL_STRING_BYTES ? value : null;
}

function addScalar(map: Map<string, IssueAlertScalar>, key: string, value: unknown): void {
  if (map.size >= MAX_SIGNAL_MAP_ENTRIES || map.has(key)) return;
  const safeKey = boundedKey(key);
  if (safeKey === null || !isScalar(value)) return;
  if (typeof value === "string" && boundedString(value) === null) return;
  map.set(safeKey, value);
}

function addRecordScalars(map: Map<string, IssueAlertScalar>, prefix: string, value: unknown): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (map.size >= MAX_SIGNAL_MAP_ENTRIES) return;
    const safeKey = boundedKey(key);
    if (safeKey === null) continue;
    const fullKey = prefix.length === 0 ? safeKey : `${prefix}.${safeKey}`;
    if (isScalar(child)) {
      addScalar(map, fullKey, child);
      continue;
    }
    if (isRecord(child)) addRecordScalars(map, fullKey, child);
  }
}

function parseEnvelope(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
  return isRecord(value) ? value : {};
}

function signalEnvelope(value: unknown): Record<string, unknown> {
  const scrubbed = scrubErrorIngestPayload(parseEnvelope(value), {
    maxDepth: 6,
    maxPayloadBytes: 256 * 1024,
    maxStringBytes: MAX_SIGNAL_STRING_BYTES,
    maxKeyBytes: MAX_SIGNAL_KEY_BYTES,
    maxCollectionEntries: MAX_SIGNAL_MAP_ENTRIES,
  });
  return isRecord(scrubbed.value) ? scrubbed.value : {};
}

function eventOccurrenceId(outcome: IssueBatchApplyOutcome, input: IssueBatchDelta): string {
  if (input.occurrenceId !== undefined && input.occurrenceId.length > 0) return input.occurrenceId;
  return createHash("sha256")
    .update(`issue-alert:${outcome.issueId}:${outcome.ownerHash}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function status(value: LoadedIssueStatus): IssueAlertStatus {
  switch (value) {
    case "RESOLVED": { return "resolved"; }
    case "IGNORED": { return "ignored"; }
    case "UNRESOLVED": { return "unresolved"; }
  }
}

function readTagsAndAttributes(value: unknown): { tags: Map<string, string>, attributes: Map<string, IssueAlertScalar> } {
  const envelope = signalEnvelope(value);
  const tags = new Map<string, string>();
  if (isRecord(envelope.tags)) {
    for (const [key, tag] of Object.entries(envelope.tags)) {
      if (tags.size >= MAX_SIGNAL_MAP_ENTRIES) break;
      if (typeof tag !== "string" || boundedString(tag) === null) continue;
      const safeKey = boundedKey(key);
      if (safeKey !== null) tags.set(safeKey, tag);
    }
  }

  const attributes = new Map<string, IssueAlertScalar>();
  addRecordScalars(attributes, "extra", envelope.extra);
  addRecordScalars(attributes, "contexts", envelope.contexts);
  addRecordScalars(attributes, "attributes", envelope.attributes);
  return { tags, attributes };
}

export function buildIssueAlertSignal(input: IssueAlertSignalInput): IssueAlertSignal {
  if (input.issue.id !== input.outcome.issueId) throw new Error("Issue alert snapshot does not match materialization outcome");
  const { tags, attributes } = readTagsAndAttributes(input.errorEnvelope);
  return {
    tenancyId: input.scope.tenancyId,
    projectId: input.scope.projectId,
    branchId: input.scope.branchId,
    issue: {
      id: input.issue.id,
      shortId: input.outcome.shortId.toString(),
      type: input.issue.type,
      value: input.issue.value,
      culprit: input.issue.culprit,
      status: status(input.issue.status),
      isNew: input.outcome.isNew,
      isRegression: input.outcome.isRegression,
    },
    occurrence: {
      id: eventOccurrenceId(input.outcome, input.input),
      occurredAt: input.input.lastEventAt,
    },
    level: normalizeIssueAlertLevel(input.input.level),
    environment: boundedIdentifierOrNull(input.input.deploymentEnvironmentName),
    release: boundedIdentifierOrNull(input.input.release),
    tags,
    attributes,
    frequencyCounts: input.frequencyCounts ?? new Map(),
  };
}
