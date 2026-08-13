import { randomUUID } from "node:crypto";
import { retryTransaction, globalPrismaClient, type PrismaClientTransaction } from "@/prisma-client";
import type {
  ErrorIngestClientReportBucket,
  ErrorIngestClientReportCategory,
  ErrorIngestClientReportEntry,
  ErrorIngestClientReportProjection,
  ErrorIngestClientReportReason,
  ErrorIngestProtocolProjection,
} from "./error-ingest-protocol-adapter";

export type ErrorIngestClientReportProtocol = "legacy_batch" | "otlp_logs" | "otlp_traces" | "sentry_envelope" | "client_report";

export type ErrorIngestClientReportScope = {
  tenancyId: string,
  projectId: string,
  branchId: string,
};

export type ErrorIngestClientReportRow = {
  tenancyId: string,
  projectId: string,
  branchId: string,
  id: string,
  protocol: ErrorIngestClientReportProtocol,
  bucket: ErrorIngestClientReportBucket,
  reason: string,
  category: string,
  quantity: number,
  idempotencyKey: string,
  reportedAt: Date,
};

export type ErrorIngestClientReportRequest = {
  clientReport: ErrorIngestClientReportProjection,
  idempotencyKey: string,
  /** Sentry client reports use Unix seconds or an ISO-8601 timestamp. */
  timestampMs?: number,
};

/** Relay shifts client-report timestamps when the envelope clock is badly skewed. */
export const ERROR_INGEST_CLIENT_REPORT_MIN_CLOCK_DRIFT_MS = 55 * 60 * 1_000;

const REPORT_BUCKETS: readonly ErrorIngestClientReportBucket[] = [
  "discarded_events",
  "rate_limited_events",
  "filtered_events",
  "filtered_sampling_events",
];
const MAX_REPORT_ROWS = 100;
const MAX_REPORT_QUANTITY = 1_000_000_000;
/** Mirrors ErrorIngestClientReport.reason/category VARCHAR(64) columns. */
export const ERROR_INGEST_CLIENT_REPORT_REASON_CATEGORY_MAX_BYTES = 64;
/** Mirrors ErrorIngestClientReport.idempotencyKey VARCHAR(256). */
export const ERROR_INGEST_CLIENT_REPORT_IDEMPOTENCY_KEY_MAX_BYTES = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && Buffer.byteLength(value, "utf8") <= maxBytes;
}

function validateScope(scope: ErrorIngestClientReportScope): void {
  if (!UUID_PATTERN.test(scope.tenancyId)) throw new Error("Error ingest client report tenancyId must be a UUID");
  if (!isBoundedText(scope.projectId, ERROR_INGEST_CLIENT_REPORT_IDEMPOTENCY_KEY_MAX_BYTES)) throw new Error("Error ingest client report projectId is invalid");
  if (!isBoundedText(scope.branchId, ERROR_INGEST_CLIENT_REPORT_IDEMPOTENCY_KEY_MAX_BYTES)) throw new Error("Error ingest client report branchId is invalid");
}

function validateProtocol(protocol: ErrorIngestClientReportProtocol): void {
  if (!["legacy_batch", "otlp_logs", "otlp_traces", "sentry_envelope", "client_report"].includes(protocol)) {
    throw new Error("Error ingest client report protocol is invalid");
  }
}

function validateEntry(entry: ErrorIngestClientReportEntry): void {
  if (
    !isBoundedText(entry.reason, ERROR_INGEST_CLIENT_REPORT_REASON_CATEGORY_MAX_BYTES)
    || !isBoundedText(entry.category, ERROR_INGEST_CLIENT_REPORT_REASON_CATEGORY_MAX_BYTES)
  ) {
    throw new Error("Error ingest client report reason and category must be bounded strings");
  }
  if (!Number.isSafeInteger(entry.quantity) || entry.quantity <= 0 || entry.quantity > MAX_REPORT_QUANTITY) {
    throw new Error("Error ingest client report quantity is outside the supported range");
  }
}

function isReportQuantity(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_REPORT_QUANTITY;
}

function parseReportTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;

  let timestampMs: number;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Error ingest client report timestamp is invalid");
    // Relay's UnixTimestamp is expressed in seconds. Accepting millisecond
    // values as well keeps this boundary compatible with browser adapters that
    // already operate in Date#getTime units without widening the date range.
    timestampMs = Math.abs(value) >= 100_000_000_000 ? value : value * 1_000;
  } else if (typeof value === "string") {
    if (!isBoundedText(value, 64)) throw new Error("Error ingest client report timestamp is invalid");
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error("Error ingest client report timestamp is invalid");
    timestampMs = parsed;
  } else {
    throw new Error("Error ingest client report timestamp is invalid");
  }

  if (!Number.isSafeInteger(timestampMs) || !Number.isFinite(new Date(timestampMs).getTime())) {
    throw new Error("Error ingest client report timestamp is outside the supported date range");
  }
  return timestampMs;
}

export function normalizeErrorIngestClientReportReportedAt(
  request: ErrorIngestClientReportRequest,
  sentAt: Date | null,
  receivedAt: Date,
): Date {
  if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
    throw new Error("Error ingest client report receivedAt must be a valid date");
  }
  if (request.timestampMs === undefined) return receivedAt;
  const clientTimestamp = new Date(request.timestampMs);
  if (!Number.isFinite(clientTimestamp.getTime())) throw new Error("Error ingest client report timestamp is invalid");
  if (sentAt === null || !Number.isFinite(sentAt.getTime())) return clientTimestamp;

  const clockDriftMs = receivedAt.getTime() - sentAt.getTime();
  return Math.abs(clockDriftMs) >= ERROR_INGEST_CLIENT_REPORT_MIN_CLOCK_DRIFT_MS
    ? new Date(clientTimestamp.getTime() + clockDriftMs)
    : clientTimestamp;
}

function entriesForBucket(
  projection: ErrorIngestClientReportProjection,
  bucket: ErrorIngestClientReportBucket,
): readonly ErrorIngestClientReportEntry[] {
  switch (bucket) {
    case "discarded_events": {
      return projection.discarded_events;
    }
    case "rate_limited_events": {
      return projection.rate_limited_events;
    }
    case "filtered_events": {
      return projection.filtered_events;
    }
    case "filtered_sampling_events": {
      return projection.filtered_sampling_events;
    }
  }
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseReportEntries(value: unknown, field: string): ErrorIngestClientReportEntry[] {
  if (!Array.isArray(value) || value.length > MAX_REPORT_ROWS) throw new Error(`${field} must be an array with at most ${MAX_REPORT_ROWS} entries`);
  return value.map((entry) => {
    if (!isRecord(entry)) throw new Error(`${field} entries must be objects`);
    const reason = entry.reason;
    const category = entry.category;
    const quantity = entry.quantity;
    // Relay deliberately preserves forward-compatible reason/category strings;
    // validate their size and control characters without freezing this API to
    // today's data-category vocabulary.
    if (
      !isBoundedText(reason, ERROR_INGEST_CLIENT_REPORT_REASON_CATEGORY_MAX_BYTES)
      || !isBoundedText(category, ERROR_INGEST_CLIENT_REPORT_REASON_CATEGORY_MAX_BYTES)
    ) {
      throw new Error(`${field} reason and category are not supported bounded values`);
    }
    if (!isReportQuantity(quantity)) {
      throw new Error(`${field} quantity is outside the supported range`);
    }
    return { reason, category, quantity };
  });
}

export function parseErrorIngestClientReportRequest(value: unknown): ErrorIngestClientReportRequest {
  if (!isRecord(value)) throw new Error("Error ingest client report must be an object");
  if (!isBoundedText(value.idempotency_key, ERROR_INGEST_CLIENT_REPORT_IDEMPOTENCY_KEY_MAX_BYTES)) throw new Error("Error ingest client report idempotency_key is required and must be bounded");
  const timestampMs = parseReportTimestamp(value.timestamp);
  const clientReport = {
    discarded_events: parseReportEntries(value.discarded_events, "discarded_events"),
    rate_limited_events: parseReportEntries(value.rate_limited_events, "rate_limited_events"),
    filtered_events: parseReportEntries(value.filtered_events, "filtered_events"),
    filtered_sampling_events: parseReportEntries(value.filtered_sampling_events, "filtered_sampling_events"),
  } satisfies ErrorIngestClientReportProjection;
  if (Object.values(clientReport).reduce((count, entries) => count + entries.length, 0) > MAX_REPORT_ROWS) {
    throw new Error(`Error ingest client report contains more than ${MAX_REPORT_ROWS} entries`);
  }
  return {
    clientReport,
    idempotencyKey: value.idempotency_key,
    ...(timestampMs === undefined ? {} : { timestampMs }),
  };
}

export function buildErrorIngestClientReportRows(
  scope: ErrorIngestClientReportScope,
  protocol: ErrorIngestClientReportProtocol,
  projection: Pick<ErrorIngestProtocolProjection, "clientReport" | "idempotencyKey">,
  reportedAt = new Date(),
): readonly ErrorIngestClientReportRow[] {
  validateScope(scope);
  validateProtocol(protocol);
  if (!(reportedAt instanceof Date) || Number.isNaN(reportedAt.getTime())) {
    throw new Error("Error ingest client report reportedAt must be a valid date");
  }
  if (!isBoundedText(projection.idempotencyKey, ERROR_INGEST_CLIENT_REPORT_IDEMPOTENCY_KEY_MAX_BYTES)) throw new Error("Error ingest client report idempotency key is invalid");

  const rows: ErrorIngestClientReportRow[] = [];
  for (const bucket of REPORT_BUCKETS) {
    for (const entry of entriesForBucket(projection.clientReport, bucket)) {
      if (rows.length >= MAX_REPORT_ROWS) throw new Error("Error ingest client report contains too many entries");
      validateEntry(entry);
      rows.push({
        ...scope,
        id: randomUUID(),
        protocol,
        bucket,
        reason: entry.reason,
        category: entry.category,
        quantity: entry.quantity,
        idempotencyKey: projection.idempotencyKey,
        reportedAt,
      });
    }
  }
  return rows;
}

export function buildErrorIngestClientReportRequestRows(
  scope: ErrorIngestClientReportScope,
  request: ErrorIngestClientReportRequest,
  reportedAt = new Date(),
): readonly ErrorIngestClientReportRow[] {
  return buildErrorIngestClientReportRows(
    scope,
    "client_report",
    request,
    request.timestampMs === undefined ? reportedAt : new Date(request.timestampMs),
  );
}

export async function persistErrorIngestClientReportProjection(
  scope: ErrorIngestClientReportScope,
  protocol: ErrorIngestClientReportProtocol,
  projection: Pick<ErrorIngestProtocolProjection, "clientReport" | "idempotencyKey">,
  client: typeof globalPrismaClient = globalPrismaClient,
  reportedAt = new Date(),
): Promise<number> {
  const rows = buildErrorIngestClientReportRows(scope, protocol, projection, reportedAt);
  if (rows.length === 0) return 0;
  return await retryTransaction(client, async (tx: PrismaClientTransaction) => {
    const result = await tx.errorIngestClientReport.createMany({
      data: rows.map((row) => ({ ...row })),
      skipDuplicates: true,
    });
    return result.count;
  });
}

export async function persistErrorIngestClientReportRequest(
  scope: ErrorIngestClientReportScope,
  request: ErrorIngestClientReportRequest,
  client: typeof globalPrismaClient = globalPrismaClient,
  reportedAt = new Date(),
): Promise<number> {
  const rows = buildErrorIngestClientReportRequestRows(scope, request, reportedAt);
  if (rows.length === 0) return 0;
  return await retryTransaction(client, async (tx: PrismaClientTransaction) => {
    const result = await tx.errorIngestClientReport.createMany({
      data: rows.map((row) => ({ ...row })),
      skipDuplicates: true,
    });
    return result.count;
  });
}
