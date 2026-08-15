import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import type { PublicSearchFilters, PublicSearchRecordType } from "./contract";

export type PublicSearchIssueCursorPosition = {
  kind: "issue",
  lastSeenAtMillis: number,
  issueId: string,
};

export type PublicSearchOccurrenceCursorPosition = {
  kind: "occurrence",
  eventAtMillis: number,
  occurrenceId: string,
};

export type PublicSearchCursorPosition = PublicSearchIssueCursorPosition | PublicSearchOccurrenceCursorPosition;

type CursorExpected = {
  projectId: string,
  branchId: string,
  filters: PublicSearchFilters,
};

type CursorInput = CursorExpected & {
  position: PublicSearchCursorPosition,
};

type UnsignedCursor = {
  version: 1,
  project_id: string,
  branch_id: string,
  record: PublicSearchRecordType,
  filter_hash: string,
  position: PublicSearchCursorPosition,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeMillis(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 8_640_000_000_000_000;
}

function isRecordType(value: unknown): value is PublicSearchRecordType {
  return value === "issue" || value === "event" || value === "occurrence";
}

function isBase64Url(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

function cursorSecret(secret: string | undefined): string {
  return secret === undefined ? getEnvVariable("STACK_SERVER_SECRET") : secret;
}

function filterBinding(filters: PublicSearchFilters): string {
  return JSON.stringify({
    record: filters.record,
    hours: filters.hours,
    issueHash: filters.issueHash,
    eventId: filters.eventId,
    tagKey: filters.tagKey,
    tagValue: filters.tagValue,
    message: filters.message,
    status: filters.status,
    level: filters.level,
    handled: filters.handled,
    userId: filters.userId,
    release: filters.release,
    environment: filters.environment,
    service: filters.service,
    attachmentFilename: filters.attachmentFilename,
    attachmentContentType: filters.attachmentContentType,
    attachmentType: filters.attachmentType,
    contextKey: filters.contextKey,
    contextValue: filters.contextValue,
    propertyKey: filters.propertyKey,
    propertyValue: filters.propertyValue,
    facets: filters.facets,
    limit: filters.limit,
  });
}

export function publicSearchFilterHash(filters: PublicSearchFilters): string {
  return createHash("sha256").update(filterBinding(filters)).digest("hex");
}

function unsignedCursor(input: CursorInput): UnsignedCursor {
  return {
    version: 1,
    project_id: input.projectId,
    branch_id: input.branchId,
    record: input.filters.record,
    filter_hash: publicSearchFilterHash(input.filters),
    position: input.position,
  };
}

function signature(value: UnsignedCursor, secret: string | undefined): string {
  return createHmac("sha256", cursorSecret(secret)).update(JSON.stringify(value)).digest("base64url");
}

function hasValidPosition(value: unknown, record: PublicSearchRecordType): value is PublicSearchCursorPosition {
  if (!isRecord(value)) return false;
  if (record === "issue") {
    return value.kind === "issue"
      && isSafeMillis(value.lastSeenAtMillis)
      && typeof value.issueId === "string"
      && isUuid(value.issueId);
  }
  return value.kind === "occurrence"
    && isSafeMillis(value.eventAtMillis)
    && typeof value.occurrenceId === "string"
    && value.occurrenceId.length > 0
    && value.occurrenceId.length <= 256;
}

function sameSignature(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function encodePublicSearchCursor(input: CursorInput, secret?: string): string {
  const unsigned = unsignedCursor(input);
  const payload = {
    ...unsigned,
    signature: signature(unsigned, secret),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePublicSearchCursor(
  raw: string,
  expected: CursorExpected,
  secret?: string,
): PublicSearchCursorPosition | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.version !== 1 || parsed.project_id !== expected.projectId || parsed.branch_id !== expected.branchId) return null;
  if (!isRecordType(parsed.record) || parsed.record !== expected.filters.record) return null;
  if (parsed.filter_hash !== publicSearchFilterHash(expected.filters)) return null;
  if (!hasValidPosition(parsed.position, expected.filters.record)) return null;
  if (!isBase64Url(parsed.signature)) return null;

  const unsigned: UnsignedCursor = {
    version: 1,
    project_id: parsed.project_id,
    branch_id: parsed.branch_id,
    record: parsed.record,
    filter_hash: parsed.filter_hash,
    position: parsed.position,
  };
  if (!sameSignature(parsed.signature, signature(unsigned, secret))) return null;
  return parsed.position;
}
