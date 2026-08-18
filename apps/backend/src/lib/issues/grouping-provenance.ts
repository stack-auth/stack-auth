import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { isGroupingConfigId } from "./grouping-config";
import type {
  GroupingFingerprintSource,
  GroupingFingerprintType,
  GroupingHashProvenance,
  GroupingVariant,
} from "./types";

/**
 * JSON shape persisted outside the grouping implementation. The snake-case
 * keys are intentional: this is shared by the Postgres issue-hash ledger, the
 * ClickHouse occurrence read model, and the public occurrence projection.
 * Keeping one bounded shape at this boundary prevents each layer from inventing
 * a slightly different explanation for the same Sentry-style decision.
 */
export type DurableGroupingHashProvenance = {
  hash: string,
  role: "primary" | "secondary",
  config_id: string,
  variant: string,
  fingerprint: {
    type: string,
    source: string,
    tokens: string[],
    resolved_tokens: string[],
  },
};

/**
 * A transition currently has one primary and a small readable secondary set.
 * This bound is deliberately independent of the event payload cap: it protects
 * the durable issue/hash row even if grouping emits more variants than the
 * current app/system pair.
 */
export const MAX_GROUPING_PROVENANCE_ENTRIES = 16;

export function toDurableGroupingProvenance(
  provenance: readonly GroupingHashProvenance[],
): DurableGroupingHashProvenance[] {
  if (provenance.length > MAX_GROUPING_PROVENANCE_ENTRIES) {
    throw new Error(`Grouping provenance exceeds the ${MAX_GROUPING_PROVENANCE_ENTRIES}-entry limit`);
  }

  return provenance.map((entry) => ({
    hash: entry.hash,
    role: entry.role,
    config_id: entry.configId,
    variant: entry.variant,
    fingerprint: {
      type: entry.fingerprint.type,
      source: entry.fingerprint.source,
      tokens: [...entry.fingerprint.tokens],
      resolved_tokens: [...entry.fingerprint.resolvedTokens],
    },
  }));
}

export function serializeGroupingProvenance(
  provenance: readonly GroupingHashProvenance[],
): string {
  return JSON.stringify(toDurableGroupingProvenance(provenance));
}

// Total records rather than plain arrays: adding a member to one of the unions
// in `types.ts` without listing it here must be a compile error, or the parser
// below would start rejecting rows the writer legitimately produces.
const GROUPING_VARIANT_SET: Record<GroupingVariant, true> = { app: true, system: true, message: true, custom: true, degraded: true };
const GROUPING_FINGERPRINT_TYPE_SET: Record<GroupingFingerprintType, true> = { default: true, custom: true, hybrid: true };
const GROUPING_FINGERPRINT_SOURCE_SET: Record<GroupingFingerprintSource, true> = { default: true, event: true, degraded: true };

function isGroupingVariant(value: unknown): value is GroupingVariant {
  return typeof value === "string" && Object.hasOwn(GROUPING_VARIANT_SET, value);
}

function isGroupingFingerprintType(value: unknown): value is GroupingFingerprintType {
  return typeof value === "string" && Object.hasOwn(GROUPING_FINGERPRINT_TYPE_SET, value);
}

function isGroupingFingerprintSource(value: unknown): value is GroupingFingerprintSource {
  return typeof value === "string" && Object.hasOwn(GROUPING_FINGERPRINT_SOURCE_SET, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Stored grouping provenance has a malformed ${label} list`);
  return value.map((item) => typeof item === "string" ? item : throwErr(`Stored grouping provenance has a malformed ${label} list`));
}

/**
 * Parses the durable JSON written by `serializeGroupingProvenance` back into
 * the storage shape. Strictly structural on purpose: this column is written by
 * our own ingest path on every `$error` occurrence, so a malformed value is
 * corruption (or a writer bug) and must fail loudly rather than degrade into
 * an occurrence with invented or missing grouping evidence. Config ids are NOT
 * narrowed here — whether an id is still shipped is the caller's policy (the
 * reconciler skips retired configs instead of crashing on them).
 */
export function parseDurableGroupingProvenance(raw: string): DurableGroupingHashProvenance[] {
  if (raw === "") {
    throw new Error("Stored grouping provenance is empty; every $error occurrence row carries issue_grouping_provenance at ingest");
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Stored grouping provenance must be a JSON array");
  if (parsed.length === 0 || parsed.length > MAX_GROUPING_PROVENANCE_ENTRIES) {
    throw new Error(`Stored grouping provenance must contain between 1 and ${MAX_GROUPING_PROVENANCE_ENTRIES} entries`);
  }

  return parsed.map((entry): DurableGroupingHashProvenance => {
    if (!isRecord(entry)
      || typeof entry.hash !== "string"
      || (entry.role !== "primary" && entry.role !== "secondary")
      || typeof entry.config_id !== "string"
      || typeof entry.variant !== "string"
      || !isRecord(entry.fingerprint)
      || typeof entry.fingerprint.type !== "string"
      || typeof entry.fingerprint.source !== "string") {
      throw new Error("Stored grouping provenance contains a malformed entry");
    }
    return {
      hash: entry.hash,
      role: entry.role,
      config_id: entry.config_id,
      variant: entry.variant,
      fingerprint: {
        type: entry.fingerprint.type,
        source: entry.fingerprint.source,
        tokens: parseStringArray(entry.fingerprint.tokens, "fingerprint token"),
        resolved_tokens: parseStringArray(entry.fingerprint.resolved_tokens, "resolved fingerprint token"),
      },
    };
  });
}

/**
 * Narrows durable entries back to the typed in-process shape. The caller must
 * already have decided that every `config_id` is a config it wants to handle
 * (see `parseDurableGroupingProvenance`); an unknown id here is therefore a
 * violated caller contract, not a data-quality condition.
 */
export function fromDurableGroupingProvenance(
  entries: readonly DurableGroupingHashProvenance[],
): GroupingHashProvenance[] {
  return entries.map((entry): GroupingHashProvenance => ({
    hash: entry.hash,
    role: entry.role,
    configId: isGroupingConfigId(entry.config_id)
      ? entry.config_id
      : throwErr(`Stored grouping provenance references unknown config id ${JSON.stringify(entry.config_id)}; the caller must filter retired configs before converting`),
    variant: isGroupingVariant(entry.variant)
      ? entry.variant
      : throwErr(`Stored grouping provenance references unknown variant ${JSON.stringify(entry.variant)}`),
    fingerprint: {
      type: isGroupingFingerprintType(entry.fingerprint.type)
        ? entry.fingerprint.type
        : throwErr(`Stored grouping provenance references unknown fingerprint type ${JSON.stringify(entry.fingerprint.type)}`),
      source: isGroupingFingerprintSource(entry.fingerprint.source)
        ? entry.fingerprint.source
        : throwErr(`Stored grouping provenance references unknown fingerprint source ${JSON.stringify(entry.fingerprint.source)}`),
      tokens: [...entry.fingerprint.tokens],
      resolvedTokens: [...entry.fingerprint.resolved_tokens],
    },
  }));
}
