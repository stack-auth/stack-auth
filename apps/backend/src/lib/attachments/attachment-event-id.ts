const EVENT_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Attachments are keyed by the event id, while historical ClickHouse rows may
 * only have the derived occurrence id. Prefer the canonical envelope value and
 * accept a legacy value only when it is already the same strict id shape.
 * Anything else is deliberately treated as unjoinable rather than guessing at
 * a user-controlled field.
 */
export function getErrorAttachmentEventId(input: {
  occurrenceId: string,
  data: Record<string, unknown>,
  errorEnvelope: Record<string, unknown> | null,
}): string | null {
  const candidates = [
    input.errorEnvelope?.event_id,
    input.data.event_id,
    input.occurrenceId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && EVENT_ID_RE.test(candidate.toLowerCase())) return candidate.toLowerCase();
  }
  return null;
}
