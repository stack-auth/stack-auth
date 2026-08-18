import { throwErr } from "@hexclave/shared/dist/utils/errors";

const EVENT_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Attachments are keyed by the occurrence's event id. `occurrence_id` IS that
 * id: both ingest paths store the client-supplied event id as the occurrence id
 * whenever the client sent one (the native batch path via `getOccurrenceId`,
 * the OTLP path via `getOtlpLogOccurrenceId`), and otherwise derive a
 * deterministic 32-hex digest from `(batch_id, ordinal)`. Either way the value
 * matches the strict id shape by construction, so anything else reaching this
 * function means an ingest writer stopped upholding that invariant — fail
 * loudly instead of quietly showing an occurrence without its attachments.
 *
 * Deliberately NOT read from `data.event_id` or the error envelope: the
 * envelope normalizer derives a fallback `event_id` server-side when the client
 * sent none, and that derived id can never match an uploaded attachment's key
 * (the client never learns it), while a client-sent id is already the
 * occurrence id.
 */
export function getErrorAttachmentEventId(occurrenceId: string): string {
  return EVENT_ID_RE.test(occurrenceId)
    ? occurrenceId
    : throwErr(`Occurrence id ${JSON.stringify(occurrenceId)} is not a 32-hex event id; ingest derives every occurrence id from the client event id or a SHA-256 digest, so this row was written by a broken writer`);
}
