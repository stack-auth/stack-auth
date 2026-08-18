import {
  PUBLIC_ISSUE_PAGE_SIZE,
  type PublicIssueOccurrence,
} from "@/app/api/latest/issues/contract";
import { getErrorAttachmentEventId } from "@/lib/attachments/attachment-event-id";
import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { mapWithConcurrency } from "@hexclave/shared/dist/utils/promises";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { loadIssueDetailContext } from "./issue-detail";
import { encodeOccurrenceCursor, type OccurrenceCursor } from "./issue-queries";
import { loadPublicIssueAttachments } from "./occurrence-attachments";
import {
  occurrenceTimestamp,
  parsePublicErrorEnvelope,
  projectPublicIssueOccurrence,
  resolveOccurrenceReplayIds,
  type PublicOccurrenceRow,
} from "./occurrence-projection";

/**
 * The paginated occurrence list for one issue: resolve the issue's owned
 * hashes, page over the ClickHouse read model by `(event_at, occurrence_id)`,
 * then enrich (replay links, attachments) and project each row. The
 * single-occurrence navigation used by the detail views lives in
 * `issue-queries.ts` (`loadOccurrence`); this module is the batched sibling.
 */
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

  const context = await loadIssueDetailContext(options.tenancy, options.issueId);
  if (context === null) return null;
  if (context.hashes.length === 0) return { items: [], next_cursor: null };

  const comparison = options.cursor === null
    ? ""
    : options.direction === "older"
      ? "AND (event_at, occurrence_id) < ({cursorAt:DateTime64(3)}, {cursorId:String})"
      : "AND (event_at, occurrence_id) > ({cursorAt:DateTime64(3)}, {cursorId:String})";
  const order = options.direction === "older" ? "DESC" : "ASC";
  // `message` (not `body`): for `$error` rows the human-readable message is
  // promoted server-side into the `message` column; `body` holds the OTLP
  // AnyValue, which is the JSON null literal for everything that isn't `$log`.
  const resultSet = await getSharedClickhouseAdminClient().query({
    query: `
      SELECT occurrence_id, event_at, message, level, data, error_envelope,
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
  const prepared = page.map((row) => {
    const errorEnvelope = parsePublicErrorEnvelope(row.error_envelope);
    return {
      row,
      errorEnvelope,
      attachmentEventId: getErrorAttachmentEventId({
        occurrenceId: row.occurrence_id,
        data: row.data,
        errorEnvelope,
      }),
    };
  });
  const attachmentEventIds = prepared
    .map((entry) => entry.attachmentEventId)
    .filter((eventId): eventId is string => eventId !== null);
  const attachmentsByEvent = await loadPublicIssueAttachments(options.tenancy, attachmentEventIds);
  const last = page.at(-1);
  // Symbolication may perform an artifact lookup per frame. Keep the page
  // responsive when one artifact store call is slow without opening an
  // unbounded burst against the storage backend.
  const items = await mapWithConcurrency(
    prepared,
    8,
    async (entry) => await projectPublicIssueOccurrence(entry.row, {
      scope: {
        tenantId: options.tenancy.id,
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      },
      errorEnvelope: entry.errorEnvelope,
      attachments: entry.attachmentEventId === null ? [] : attachmentsByEvent.get(entry.attachmentEventId) ?? [],
    }),
  );
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
