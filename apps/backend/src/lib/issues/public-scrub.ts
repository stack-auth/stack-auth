import { scrubErrorIngestPayload } from "@/lib/error-ingest";

export { isRecord } from "@hexclave/shared/dist/utils/objects";

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
