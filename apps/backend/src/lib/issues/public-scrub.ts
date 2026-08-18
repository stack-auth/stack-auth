import { scrubErrorIngestPayload } from "@/lib/error-ingest";

/**
 * Scrub helpers for values that leave the trust boundary through issue
 * projections. Stored occurrence payloads are scrubbed again on the way OUT
 * (not only at ingest) so a scrubber improvement immediately applies to rows
 * that were stored before it shipped.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scrubPublicValue(value: unknown): unknown {
  return scrubErrorIngestPayload(value).value;
}

export function scrubPublicText(value: string): string {
  const scrubbed = scrubPublicValue(value);
  return typeof scrubbed === "string" ? scrubbed : "";
}

export function scrubPublicOptionalText(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const scrubbed = scrubPublicValue(value);
  return typeof scrubbed === "string" && scrubbed.length > 0 ? scrubbed : null;
}

export function scrubPublicRecord(value: unknown): Record<string, unknown> {
  const scrubbed = scrubPublicValue(value);
  return isRecord(scrubbed) ? scrubbed : {};
}
