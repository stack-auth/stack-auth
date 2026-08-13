import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { Prisma } from "@/generated/prisma/client";
import { KnownErrors } from "@hexclave/shared";
import {
  type IssueAttachment,
  type IssueListItem,
  type IssueProductMetadata,
} from "@hexclave/shared/dist/interface/admin-issues";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isJsonSerializable } from "@hexclave/shared/dist/utils/json";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { scrubErrorIngestPayload } from "@/lib/error-ingest";
import { getErrorAttachmentEventId } from "../attachments/attachment-event-id";
import { MAX_ERROR_ATTACHMENTS_PER_EVENT } from "../attachments/attachment-contract";
import { createS3ArtifactObjectStorage } from "../artifacts/artifact-storage";
import { ArtifactServiceError } from "../artifacts/artifact-errors";
import { validateArtifactMetadata } from "../artifacts/artifact-manifest";
import { ArtifactUploadService } from "../artifacts/artifact-upload-service";
import { loadIssueProductSnapshot } from "./issue-product";
import { serializeIssueProductSnapshot } from "./issue-product-projection";
import { loadIssueReleaseContext } from "../releases/issue-release-context";
import {
  JavaScriptSymbolicationService,
  type RawJavaScriptFrame,
  type SymbolicatedJavaScriptFrame,
  type SymbolicationDiagnostic,
} from "../symbolication";
import {
  deriveSubstatus,
  encodeOccurrenceCursor,
  issueRangeStart,
  loadIssueWindowStats,
  loadOccurrence,
  type OccurrenceCursor,
} from "./issue-queries";
import {
  PUBLIC_ISSUE_PAGE_SIZE,
  type PublicIssueErrorEnvelope,
  type PublicIssueFrame,
  type PublicIssueFrameSymbolication,
  type PublicIssue,
  type PublicIssueOccurrence,
  type IssueGroupingHashProvenance,
  type PublicIssueSymbolicationDiagnostic,
} from "@/app/api/latest/issues/contract";

type PublicIssueRow = {
  id: string,
  shortId: bigint,
  type: string,
  value: string,
  culprit: string,
  status: "UNRESOLVED" | "RESOLVED" | "IGNORED",
  firstSeenAt: Date,
  lastSeenAt: Date,
  regressedAt: Date | null,
  ignoredUntil: Date | null,
  timesSeen: bigint,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  firstSeenRelease: string | null,
  lastSeenRelease: string | null,
  updatedAt: Date,
  handled: boolean,
  synthetic: boolean,
  hashes: string[],
};

type PublicIssueContext = {
  row: PublicIssueRow,
  hashes: string[],
};

export type PublicOccurrenceRow = {
  occurrence_id: string,
  event_at: string,
  message: string,
  level: string,
  data: Record<string, unknown>,
  error_envelope: string | null,
  issue_grouping_provenance: string,
  error_frames: string,
  trace_id: string | null,
  span_id: string | null,
  page_view_span_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  user_id: string | null,
  service_name: string | null,
  deployment_environment_name: string | null,
};

type PublicAttachmentRow = {
  id: string,
  eventId: string,
  occurrenceId: string | null,
  filename: string,
  contentType: string,
  attachmentType: string,
  byteLength: number,
  sha256: string,
  createdAt: Date,
};

type StoredIssueFrame = {
  filename: string | null,
  function: string | null,
  module: string | null,
  absPath: string | null,
  lineno: number | null,
  colno: number | null,
  inApp: boolean,
  debugId: string | null,
};

type StoredDebugImage = {
  codeFile: string,
  debugId: string | null,
};

export type PublicIssueSymbolicator = Pick<JavaScriptSymbolicationService, "symbolicate">;

const PUBLIC_ISSUE_SYMBOLICATOR: PublicIssueSymbolicator = (() => {
  const storage = createS3ArtifactObjectStorage();
  return new JavaScriptSymbolicationService(new ArtifactUploadService(storage), storage);
})();

type SymbolicationMetadata = {
  release: string | null,
  dist: string | null,
  debugImages: readonly StoredDebugImage[],
};

type MetadataDiagnosticCode = "missing_release_metadata" | "invalid_release_metadata" | "invalid_dist_metadata";

function metadataDiagnostic(code: MetadataDiagnosticCode, message: string): PublicIssueSymbolicationDiagnostic {
  return { code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scrubPublicValue(value: unknown): unknown {
  return scrubErrorIngestPayload(value).value;
}

function scrubPublicText(value: string): string {
  const scrubbed = scrubPublicValue(value);
  return typeof scrubbed === "string" ? scrubbed : "";
}

function scrubPublicRecord(value: unknown): Record<string, unknown> {
  const scrubbed = scrubPublicValue(value);
  return isRecord(scrubbed) ? scrubbed : {};
}

const PUBLIC_ERROR_ENVELOPE_MAX_BYTES = 256 * 1024;
const PUBLIC_ERROR_ENVELOPE_TEXT_ENCODER = new TextEncoder();
const PUBLIC_GROUPING_PROVENANCE_MAX_BYTES = 64 * 1024;
const PUBLIC_GROUPING_PROVENANCE_TEXT_ENCODER = new TextEncoder();
const PUBLIC_GROUPING_PROVENANCE_MAX_ENTRIES = 16;

function parsePublicStringArray(value: unknown, maximumLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    values.push(scrubPublicText(item));
  }
  return values;
}

function parsePublicGroupingProvenance(raw: string): IssueGroupingHashProvenance[] {
  if (raw === "" || PUBLIC_GROUPING_PROVENANCE_TEXT_ENCODER.encode(raw).byteLength > PUBLIC_GROUPING_PROVENANCE_MAX_BYTES) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  if (!Array.isArray(parsed) || parsed.length > PUBLIC_GROUPING_PROVENANCE_MAX_ENTRIES) return [];

  const result: IssueGroupingHashProvenance[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) return [];
    const role = item.role;
    if (role !== "primary" && role !== "secondary") return [];
    if (
      typeof item.hash !== "string"
      || typeof item.config_id !== "string"
      || typeof item.variant !== "string"
      || !isRecord(item.fingerprint)
      || typeof item.fingerprint.type !== "string"
      || typeof item.fingerprint.source !== "string"
    ) return [];
    const tokens = parsePublicStringArray(item.fingerprint.tokens, 32);
    const resolvedTokens = parsePublicStringArray(item.fingerprint.resolved_tokens, 32);
    if (tokens === null || resolvedTokens === null) return [];
    result.push({
      hash: scrubPublicText(item.hash),
      role,
      config_id: scrubPublicText(item.config_id),
      variant: scrubPublicText(item.variant),
      fingerprint: {
        type: scrubPublicText(item.fingerprint.type),
        source: scrubPublicText(item.fingerprint.source),
        tokens,
        resolved_tokens: resolvedTokens,
      },
    });
  }
  return result;
}

function isPublicErrorEnvelope(value: unknown): value is PublicIssueErrorEnvelope {
  return isRecord(value) && Object.values(value).every(isJsonSerializable);
}

function parsePublicErrorEnvelope(raw: string | null): PublicIssueErrorEnvelope | null {
  if (raw === null || raw === "") return null;
  if (PUBLIC_ERROR_ENVELOPE_TEXT_ENCODER.encode(raw).byteLength > PUBLIC_ERROR_ENVELOPE_MAX_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const scrubbed = scrubPublicValue(parsed);
  return isPublicErrorEnvelope(scrubbed) ? scrubbed : null;
}

async function loadPublicIssueAttachments(
  tenancy: Tenancy,
  eventIds: readonly string[],
): Promise<Map<string, IssueAttachment[]>> {
  const uniqueEventIds = [...new Set(eventIds)];
  const attachmentsByEvent = new Map<string, IssueAttachment[]>(uniqueEventIds.map((eventId) => [eventId, []]));
  if (uniqueEventIds.length === 0) return attachmentsByEvent;

  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$replica().$queryRaw<PublicAttachmentRow[]>(Prisma.sql`
    SELECT "id", "eventId", "occurrenceId", "filename", "contentType", "attachmentType",
           "byteLength", "sha256", "createdAt"
    FROM (
      SELECT
        "id", "eventId", "occurrenceId", "filename", "contentType", "attachmentType",
        "byteLength", "sha256", "createdAt",
        row_number() OVER (PARTITION BY "eventId" ORDER BY "createdAt" DESC, "id" DESC) AS "rowNumber"
      FROM "ErrorAttachment"
      WHERE "tenancyId" = ${tenancy.id}::uuid
        AND "projectId" = ${tenancy.project.id}
        AND "branchId" = ${tenancy.branchId}
        AND "eventId" IN (${Prisma.join(uniqueEventIds)})
    ) AS scoped_attachments
    WHERE "rowNumber" <= ${MAX_ERROR_ATTACHMENTS_PER_EVENT}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${Math.min(uniqueEventIds.length * MAX_ERROR_ATTACHMENTS_PER_EVENT, 5_000)}
  `);
  for (const row of rows) {
    const attachments = attachmentsByEvent.get(row.eventId);
    if (attachments === undefined || attachments.length >= MAX_ERROR_ATTACHMENTS_PER_EVENT) continue;
    attachments.push({
      id: row.id,
      event_id: row.eventId,
      occurrence_id: row.occurrenceId,
      filename: scrubPublicText(row.filename),
      content_type: scrubPublicText(row.contentType),
      attachment_type: scrubPublicText(row.attachmentType),
      byte_length: row.byteLength,
      sha256: row.sha256,
      download_path: `/api/latest/analytics/attachments/${encodeURIComponent(row.id)}`,
      created_at: row.createdAt.toISOString(),
    });
  }
  return attachmentsByEvent;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function stringField(record: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function parseStoredDebugImages(value: unknown): StoredDebugImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const codeFile = stringField(item, "code_file", "codeFile");
    if (codeFile === null || codeFile === "") return [];
    const debugIdValue = item.debug_id ?? item.debugId;
    return [{
      codeFile,
      debugId: typeof debugIdValue === "string" ? debugIdValue : null,
    }];
  });
}

function metadataSource(
  data: Record<string, unknown>,
  envelope: PublicIssueErrorEnvelope | null,
  key: string,
): Record<string, unknown> | null {
  if (hasOwn(data, key)) return data;
  if (envelope !== null && hasOwn(envelope, key)) return envelope;
  return null;
}

function readSymbolicationMetadata(
  data: Record<string, unknown>,
  envelope: PublicIssueErrorEnvelope | null,
): {
  metadata: SymbolicationMetadata | null,
  diagnostics: PublicIssueSymbolicationDiagnostic[],
} {
  const diagnostics: PublicIssueSymbolicationDiagnostic[] = [];
  let release: string | null = null;
  const releaseSource = metadataSource(data, envelope, "release");
  if (releaseSource === null) {
    diagnostics.push(metadataDiagnostic(
      "missing_release_metadata",
      "The occurrence projection and canonical error envelope do not contain an exact release value, so source-map lookup was not attempted.",
    ));
  } else {
    try {
      release = validateArtifactMetadata(releaseSource.release, "occurrence.release");
    } catch (error) {
      if (!(error instanceof ArtifactServiceError) || error.code !== "invalid_manifest") throw error;
      diagnostics.push(metadataDiagnostic("invalid_release_metadata", "The occurrence release value is not valid artifact metadata."));
    }
  }

  // The artifact registry treats an omitted distribution as the explicit
  // no-dist binding. This is a contract value, not a fallback derived from the
  // issue aggregate; the aggregate's last-seen release is never used here.
  let dist: string | null = null;
  const distSource = metadataSource(data, envelope, "dist");
  if (distSource !== null) {
    try {
      dist = validateArtifactMetadata(distSource.dist, "occurrence.dist");
    } catch (error) {
      if (!(error instanceof ArtifactServiceError) || error.code !== "invalid_manifest") throw error;
      diagnostics.push(metadataDiagnostic("invalid_dist_metadata", "The occurrence distribution value is not valid artifact metadata."));
    }
  }

  if (diagnostics.length > 0) return { metadata: null, diagnostics };
  const envelopeDebugMeta = envelope !== null && isRecord(envelope.debug_meta) ? envelope.debug_meta : null;
  return {
    metadata: {
      release,
      dist,
      debugImages: [
        ...parseStoredDebugImages(data.debug_images),
        ...parseStoredDebugImages(isRecord(data.debug_meta) ? data.debug_meta.images : undefined),
        ...parseStoredDebugImages(envelopeDebugMeta?.images),
      ],
    },
    diagnostics,
  };
}

function isValidShortId(value: string): boolean {
  if (!/^\d+$/.test(value) || value.length > 19) return false;
  return value.length < 19 || value <= "9223372036854775807";
}

function issueIdentityPredicate(rawId: string): Prisma.Sql {
  if (isValidShortId(rawId)) return Prisma.sql`i."shortId" = ${rawId}::bigint`;
  if (isUuid(rawId)) return Prisma.sql`i."id" = ${rawId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

function issueRedirectPredicate(rawId: string): Prisma.Sql {
  if (isValidShortId(rawId)) return Prisma.sql`"fromShortId" = ${rawId}::bigint`;
  if (isUuid(rawId)) return Prisma.sql`"fromIssueId" = ${rawId}::uuid`;
  throw new StatusError(StatusError.BadRequest, "issue_id must be a UUID or a numeric short id");
}

async function readIssueByIdentity(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancy: Tenancy,
  rawId: string,
): Promise<PublicIssueRow | null> {
  const rows = await prisma.$replica().$queryRaw<PublicIssueRow[]>(Prisma.sql`
    SELECT
      i."id", i."shortId", i."type", i."value", i."culprit", i."status"::text AS "status",
      i."firstSeenAt", i."lastSeenAt", i."regressedAt", i."ignoredUntil", i."timesSeen",
      i."serviceName", i."deploymentEnvironmentName", i."firstSeenRelease", i."lastSeenRelease", i."updatedAt",
      i."handled", i."synthetic",
      COALESCE(
        (SELECT array_agg(h."hash") FROM "IssueHash" h
         WHERE h."tenancyId" = i."tenancyId" AND h."issueId" = i."id"),
        ARRAY[]::text[]
      ) AS "hashes"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid
      AND ${issueIdentityPredicate(rawId)}
    LIMIT 1
  `);
  return rows.at(0) ?? null;
}

/**
 * Resolve an issue only inside the authenticated project branch. Redirects
 * are followed once so a merged issue remains readable, but the redirect row
 * itself never crosses the public response boundary.
 */
export async function resolvePublicIssueContext(
  tenancy: Tenancy,
  rawId: string,
): Promise<PublicIssueContext | null> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  const issue = await readIssueByIdentity(prisma, tenancy, rawId);
  if (issue !== null) return { row: issue, hashes: issue.hashes };

  const redirects = await prisma.$replica().$queryRaw<{ fromIssueId: string, toIssueId: string }[]>(Prisma.sql`
    SELECT "fromIssueId", "toIssueId"
    FROM "IssueRedirect"
    WHERE "tenancyId" = ${tenancy.id}::uuid
      AND ${issueRedirectPredicate(rawId)}
    LIMIT 1
  `);
  const redirect = redirects.at(0);
  if (redirect === undefined) return null;

  const redirectedIssue = await readIssueByIdentity(prisma, tenancy, redirect.toIssueId);
  return redirectedIssue === null
    ? null
    : { row: redirectedIssue, hashes: redirectedIssue.hashes };
}

export function assertPublicIssueReadEnabled(tenancy: Tenancy): void {
  if (tenancy.config.apps.installed["observability"]?.enabled !== true) {
    throw new KnownErrors.ObservabilityNotEnabled();
  }
}

function effectiveStatus(row: Pick<PublicIssueRow, "status">, ignoredUntil: Date | null, now: Date): PublicIssue["status"] {
  if (row.status === "RESOLVED") return "resolved";
  if (row.status === "IGNORED" && (ignoredUntil === null || ignoredUntil >= now)) return "ignored";
  return "unresolved";
}

function toPublicIssueRow(
  row: PublicIssueRow,
  rangeStart: Date,
  now: Date,
  stats: { occurrences: number, users: number },
): PublicIssue {
  return {
    id: row.id,
    short_id: row.shortId.toString(),
    type: row.type,
    value: row.value,
    culprit: row.culprit,
    level: "error",
    status: effectiveStatus(row, row.ignoredUntil, now),
    substatus: deriveSubstatus(row, rangeStart),
    first_seen_at_millis: row.firstSeenAt.getTime(),
    last_seen_at_millis: row.lastSeenAt.getTime(),
    times_seen: row.timesSeen.toString(),
    window_occurrences: stats.occurrences,
    window_users: stats.users,
    service_name: row.serviceName,
    environment: row.deploymentEnvironmentName === null ? null : scrubPublicText(row.deploymentEnvironmentName),
    release: row.lastSeenRelease,
    handled: row.handled,
    synthetic: row.synthetic,
    updated_at_millis: row.updatedAt.getTime(),
  };
}

export async function loadPublicIssue(options: {
  tenancy: Tenancy,
  issueId: string,
  hours: number,
}): Promise<{
  issue: PublicIssue,
  hashes: string[],
  firstSeenRelease: string | null,
  lastSeenRelease: string | null,
} | null> {
  const context = await resolvePublicIssueContext(options.tenancy, options.issueId);
  if (context === null) return null;

  const now = new Date();
  const rangeStart = issueRangeStart(options.hours, now);
  const stats = await loadIssueWindowStats({
    tenancy: options.tenancy,
    hashes: context.hashes,
    rangeStart,
  });
  return {
    issue: toPublicIssueRow(context.row, rangeStart, now, stats),
    hashes: context.hashes,
    firstSeenRelease: context.row.firstSeenRelease,
    lastSeenRelease: context.row.lastSeenRelease,
  };
}

function occurrenceTimestamp(eventAt: string): number {
  const timestamp = Date.parse(eventAt.endsWith("Z") ? eventAt : `${eventAt}Z`);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`ClickHouse returned an invalid issue occurrence timestamp: ${eventAt}`);
  }
  return timestamp;
}

function parseStoredFrames(raw: string): StoredIssueFrame[] {
  if (raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((value) => {
    if (!isRecord(value)) return [];
    const frame: StoredIssueFrame = {
      filename: typeof value.filename === "string" ? value.filename : null,
      function: typeof value.function === "string" ? value.function : null,
      module: typeof value.module === "string" ? value.module : null,
      absPath: typeof value.absPath === "string"
        ? value.absPath
        : typeof value.abs_path === "string" ? value.abs_path : null,
      lineno: typeof value.lineno === "number" ? value.lineno : null,
      colno: typeof value.colno === "number" ? value.colno : null,
      inApp: value.inApp === true || value.in_app === true,
      debugId: typeof value.debugId === "string"
        ? value.debugId
        : typeof value.debug_id === "string" ? value.debug_id : null,
    };
    return [frame];
  });
}

function emptyFrameSymbolication(
  status: PublicIssueFrameSymbolication["status"],
  diagnostics: readonly PublicIssueSymbolicationDiagnostic[],
): PublicIssueFrameSymbolication {
  return {
    status,
    source_file: null,
    original_line: null,
    original_column: null,
    name: null,
    context: null,
    diagnostics: [...diagnostics],
  };
}

function toPublicDiagnostic(diagnostic: SymbolicationDiagnostic): PublicIssueSymbolicationDiagnostic {
  return {
    code: diagnostic.code,
    message: scrubPublicText(diagnostic.message),
    ...(diagnostic.debugId === undefined ? {} : { debug_id: scrubPublicText(diagnostic.debugId) }),
    ...(diagnostic.codeFile === undefined ? {} : { code_file: scrubPublicText(diagnostic.codeFile) }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
    ...(diagnostic.source === undefined ? {} : { source: scrubPublicText(diagnostic.source) }),
  };
}

function toPublicFrameSymbolication(frame: SymbolicatedJavaScriptFrame): PublicIssueFrameSymbolication {
  const diagnostics = frame.diagnostics.map(toPublicDiagnostic);
  if (frame.location === null) return emptyFrameSymbolication("unsymbolicated", diagnostics);

  const sourceContext = frame.location.sourceContext;
  return {
    status: "symbolicated",
    source_file: scrubPublicText(frame.location.source),
    original_line: frame.location.line,
    original_column: frame.location.column,
    name: frame.location.name === null ? null : scrubPublicText(frame.location.name),
    context: sourceContext === undefined ? null : {
      pre: sourceContext.pre.map(scrubPublicText),
      line: scrubPublicText(sourceContext.line),
      post: sourceContext.post.map(scrubPublicText),
    },
    diagnostics,
  };
}

function toPublicFrame(frame: StoredIssueFrame, symbolication: PublicIssueFrameSymbolication): PublicIssueFrame {
  return {
    filename: frame.filename === null ? null : scrubPublicText(frame.filename),
    function: frame.function === null ? null : scrubPublicText(frame.function),
    module: frame.module === null ? null : scrubPublicText(frame.module),
    abs_path: frame.absPath === null ? null : scrubPublicText(frame.absPath),
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.inApp,
    ...(frame.debugId === null ? {} : { debug_id: scrubPublicText(frame.debugId) }),
    symbolication,
  };
}

function debugIdForFrame(frame: StoredIssueFrame, debugImages: readonly StoredDebugImage[]): string | null {
  if (frame.debugId !== null) return frame.debugId;
  if (frame.absPath === null || frame.absPath === "") return null;
  return debugImages.find((image) => image.codeFile === frame.absPath)?.debugId ?? null;
}

async function symbolicatePublicFrames(options: {
  frames: readonly StoredIssueFrame[],
  data: Record<string, unknown>,
  envelope: PublicIssueErrorEnvelope | null,
  scope: { tenantId: string, projectId: string, branchId: string },
  symbolicator: PublicIssueSymbolicator,
}): Promise<{
  frames: PublicIssueFrameSymbolication[],
  diagnostics: PublicIssueSymbolicationDiagnostic[],
}> {
  const metadataResult = readSymbolicationMetadata(options.data, options.envelope);
  const frameSymbolication = options.frames.map(() => emptyFrameSymbolication("not_attempted", metadataResult.diagnostics));
  if (metadataResult.metadata === null) {
    return { frames: frameSymbolication, diagnostics: metadataResult.diagnostics };
  }

  const candidates: { index: number, raw: RawJavaScriptFrame }[] = [];
  for (const [index, frame] of options.frames.entries()) {
    if (frame.absPath === null || frame.absPath === "") {
      frameSymbolication[index] = emptyFrameSymbolication("not_attempted", [{
        code: "missing_code_file_metadata",
        message: "The occurrence frame has no exact emitted artifact path, so symbolication was not attempted.",
      }]);
      continue;
    }
    candidates.push({
      index,
      raw: {
        codeFile: frame.absPath,
        debugId: debugIdForFrame(frame, metadataResult.metadata.debugImages),
        lineno: frame.lineno,
        colno: frame.colno,
        function: frame.function,
      },
    });
  }

  if (candidates.length === 0) return { frames: frameSymbolication, diagnostics: [] };

  const result = await options.symbolicator.symbolicate({
    scope: options.scope,
    release: metadataResult.metadata.release,
    dist: metadataResult.metadata.dist,
    frames: candidates.map((candidate) => candidate.raw),
    applySourceContext: true,
  });
  const diagnostics = result.diagnostics.map(toPublicDiagnostic);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const resultFrame = result.frames.at(candidateIndex);
    if (resultFrame === undefined) {
      frameSymbolication[candidate.index] = emptyFrameSymbolication("unsymbolicated", diagnostics);
      continue;
    }
    frameSymbolication[candidate.index] = toPublicFrameSymbolication(resultFrame);
  }
  return { frames: frameSymbolication, diagnostics };
}

export async function projectPublicIssueOccurrence(
  row: PublicOccurrenceRow,
  release: string | null,
  options: {
    scope: { tenantId: string, projectId: string, branchId: string },
    symbolicator?: PublicIssueSymbolicator,
    attachments?: readonly IssueAttachment[],
  },
): Promise<PublicIssueOccurrence> {
  const storedFrames = parseStoredFrames(row.error_frames);
  const errorEnvelope = parsePublicErrorEnvelope(row.error_envelope);
  const groupingProvenance = parsePublicGroupingProvenance(row.issue_grouping_provenance);
  const symbolication = await symbolicatePublicFrames({
    frames: storedFrames,
    data: row.data,
    envelope: errorEnvelope,
    scope: options.scope,
    symbolicator: options.symbolicator ?? PUBLIC_ISSUE_SYMBOLICATOR,
  });
  return {
    occurrence_id: row.occurrence_id,
    event_at_millis: occurrenceTimestamp(row.event_at),
    message: scrubPublicText(row.message),
    level: scrubPublicText(row.level),
    data: scrubPublicRecord(row.data),
    error_envelope: errorEnvelope,
    grouping_provenance: groupingProvenance,
    frames: storedFrames.map((frame, index) => toPublicFrame(
      frame,
      symbolication.frames[index] ?? emptyFrameSymbolication("not_attempted", []),
    )),
    attachments: [...options.attachments ?? []],
    raw_stack: typeof row.data.stack === "string" ? scrubPublicText(row.data.stack) : null,
    trace_id: row.trace_id,
    span_id: row.span_id,
    page_view_span_id: row.page_view_span_id,
    session_replay_id: row.session_replay_id,
    user_id: row.user_id,
    service_name: row.service_name === null ? null : scrubPublicText(row.service_name),
    environment: row.deployment_environment_name === null ? null : scrubPublicText(row.deployment_environment_name),
    release: release === null ? null : scrubPublicText(release),
    symbolication_diagnostics: symbolication.diagnostics,
  };
}

export function projectResolvedOccurrenceReplayIds(
  rows: readonly PublicOccurrenceRow[],
  segments: readonly { id: string, sessionReplayId: string }[],
): PublicOccurrenceRow[] {
  const replayIdsBySegment = new Map<string, string | null>();
  for (const segment of segments) {
    const existing = replayIdsBySegment.get(segment.id);
    // Segment IDs are random per-tab UUIDs and rotate with the replay lifecycle.
    // If corrupt or hand-written data reused one, leave it unlinked instead of
    // guessing which user's recording belongs to the occurrence.
    replayIdsBySegment.set(
      segment.id,
      existing === undefined || existing === segment.sessionReplayId ? segment.sessionReplayId : null,
    );
  }
  return rows.map((row) => ({
    ...row,
    session_replay_id: row.session_replay_id
      ?? (row.session_replay_segment_id === null
        ? null
        : replayIdsBySegment.get(row.session_replay_segment_id) ?? null),
  }));
}

async function resolveOccurrenceReplayIds(
  tenancy: Tenancy,
  rows: readonly PublicOccurrenceRow[],
): Promise<PublicOccurrenceRow[]> {
  const missingSegmentIds = [...new Set(rows.flatMap((row) =>
    row.session_replay_id === null && row.session_replay_segment_id !== null
      ? [row.session_replay_segment_id]
      : [],
  ))];
  if (missingSegmentIds.length === 0) return [...rows];

  const prisma = await getPrismaClientForTenancy(tenancy);
  const segments = await prisma.$replica().sessionReplaySegment.findMany({
    where: {
      tenancyId: tenancy.id,
      id: { in: missingSegmentIds },
    },
    select: { id: true, sessionReplayId: true },
  });
  return projectResolvedOccurrenceReplayIds(rows, segments);
}

export async function loadPublicIssueDetail(options: {
  tenancy: Tenancy,
  issueId: string,
  hours: number,
  occurrence: OccurrenceCursor | null,
  direction: "older" | "newer",
}): Promise<{
  issue: PublicIssue,
  occurrence: PublicIssueOccurrence | null,
  product: IssueProductMetadata,
  release_context: Awaited<ReturnType<typeof loadIssueReleaseContext>>,
  newer_cursor: string | null,
  older_cursor: string | null,
} | null> {
  const resolved = await loadPublicIssue({
    tenancy: options.tenancy,
    issueId: options.issueId,
    hours: options.hours,
  });
  if (resolved === null) return null;

  const occurrence = await loadOccurrence({
    tenancy: options.tenancy,
    hashes: resolved.hashes,
    cursor: options.occurrence,
    direction: options.direction,
  });
  const [resolvedOccurrence] = occurrence.occurrence === null
    ? [null]
    : await resolveOccurrenceReplayIds(options.tenancy, [occurrence.occurrence]);
  const attachmentEventId = resolvedOccurrence === null ? null : getErrorAttachmentEventId({
    occurrenceId: resolvedOccurrence.occurrence_id,
    data: resolvedOccurrence.data,
    errorEnvelope: parsePublicErrorEnvelope(resolvedOccurrence.error_envelope),
  });
  const attachmentsByEvent = await loadPublicIssueAttachments(
    options.tenancy,
    attachmentEventId === null ? [] : [attachmentEventId],
  );
  const product = serializeIssueProductSnapshot(await loadIssueProductSnapshot({
    tenancy: options.tenancy,
    issueId: resolved.issue.id,
  }));
  const releaseContext = await loadIssueReleaseContext({
    tenancy: options.tenancy,
    issueId: resolved.issue.id,
    firstSeenRelease: resolved.firstSeenRelease,
    lastSeenRelease: resolved.lastSeenRelease,
  });

  return {
    issue: resolved.issue,
    product,
    release_context: releaseContext,
    occurrence: resolvedOccurrence === null
      ? null
      : await projectPublicIssueOccurrence(resolvedOccurrence, resolved.issue.release, {
        scope: {
          tenantId: options.tenancy.id,
          projectId: options.tenancy.project.id,
          branchId: options.tenancy.branchId,
        },
        attachments: attachmentEventId === null ? [] : attachmentsByEvent.get(attachmentEventId) ?? [],
      }),
    newer_cursor: occurrence.newerCursor,
    older_cursor: occurrence.olderCursor,
  };
}

export async function loadPublicIssueOccurrences(options: {
  tenancy: Tenancy,
  issueId: string,
  cursor: OccurrenceCursor | null,
  direction: "older" | "newer",
  limit: number,
}): Promise<{ items: PublicIssueOccurrence[], next_cursor: string | null } | null> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > PUBLIC_ISSUE_PAGE_SIZE) {
    throw new StatusError(StatusError.BadRequest, `limit must be between 1 and ${PUBLIC_ISSUE_PAGE_SIZE}`);
  }

  const context = await resolvePublicIssueContext(options.tenancy, options.issueId);
  if (context === null) return null;
  if (context.hashes.length === 0) return { items: [], next_cursor: null };

  const comparison = options.cursor === null
    ? ""
    : options.direction === "older"
      ? "AND (event_at, occurrence_id) < ({cursorAt:DateTime64(3)}, {cursorId:String})"
      : "AND (event_at, occurrence_id) > ({cursorAt:DateTime64(3)}, {cursorId:String})";
  const order = options.direction === "older" ? "DESC" : "ASC";
  const resultSet = await getSharedClickhouseAdminClient().query({
    query: `
      SELECT occurrence_id, event_at, body AS message, level, data, error_envelope,
             issue_grouping_provenance, error_frames,
             trace_id, span_id, page_view_span_id, session_replay_id, session_replay_segment_id, user_id,
             service_name, deployment_environment_name
      FROM analytics_internal.telemetry
      PREWHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND event_type = '$error'
        ${comparison}
      WHERE issue_hash IN {hashes:Array(String)}
      ORDER BY event_at ${order}, occurrence_id ${order}
      LIMIT ${options.limit + 1}
    `,
    query_params: {
      projectId: options.tenancy.project.id,
      branchId: options.tenancy.branchId,
      hashes: context.hashes,
      ...options.cursor === null ? {} : {
        cursorAt: new Date(options.cursor.eventAtMillis).toISOString().replace("T", " ").replace("Z", ""),
        cursorId: options.cursor.occurrenceId,
      },
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<PublicOccurrenceRow>();
  const page = await resolveOccurrenceReplayIds(options.tenancy, rows.slice(0, options.limit));
  const attachmentEventIds = page.map((row) => getErrorAttachmentEventId({
    occurrenceId: row.occurrence_id,
    data: row.data,
    errorEnvelope: parsePublicErrorEnvelope(row.error_envelope),
  })).filter((eventId): eventId is string => eventId !== null);
  const attachmentsByEvent = await loadPublicIssueAttachments(options.tenancy, attachmentEventIds);
  const last = page.at(-1);
  const items: PublicIssueOccurrence[] = [];
  for (const row of page) {
    const attachmentEventId = getErrorAttachmentEventId({
      occurrenceId: row.occurrence_id,
      data: row.data,
      errorEnvelope: parsePublicErrorEnvelope(row.error_envelope),
    });
    items.push(await projectPublicIssueOccurrence(row, context.row.lastSeenRelease, {
      scope: {
        tenantId: options.tenancy.id,
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      },
      attachments: attachmentEventId === null ? [] : attachmentsByEvent.get(attachmentEventId) ?? [],
    }));
  }
  return {
    items,
    next_cursor: rows.length > options.limit && last !== undefined
      ? encodeOccurrenceCursor({
        eventAtMillis: occurrenceTimestamp(last.event_at),
        occurrenceId: last.occurrence_id,
      })
      : null,
  };
}
