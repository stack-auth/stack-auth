import { parameterizeMessage } from "./parameterize";
import type {
  GroupingFingerprintProvenance,
  GroupingFingerprintType,
  GroupingInput,
  ParsedFrame,
} from "./types";

/**
 * The server-side fingerprint vocabulary. These are intentionally a closed
 * set: a typo must be visible in the grouping result rather than silently
 * becoming a literal that happens to look like a variable.
 */
export const GROUPING_FINGERPRINT_TOKENS = [
  "{{ default }}",
  "{{ type }}",
  "{{ message }}",
  "{{ stack }}",
  "{{ stack.function }}",
  "{{ stack.filename }}",
  "{{ stack.abs_path }}",
  "{{ stack.module }}",
] as const;

export type GroupingFingerprintToken = typeof GROUPING_FINGERPRINT_TOKENS[number];

type GroupingFingerprintTokenName =
  | "default"
  | "type"
  | "message"
  | "stack"
  | "stack.function"
  | "stack.filename"
  | "stack.abs_path"
  | "stack.module";

export type GroupingFingerprintResolution = {
  provenance: GroupingFingerprintProvenance,
  /** Values for non-`default` tokens, in their original order. */
  resolvedValues: string[],
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readField(data: unknown, key: string): unknown {
  return isRecord(data) ? data[key] : undefined;
}

/**
 * Wire bounds for a custom fingerprint. These exist because the durable
 * provenance projection is READ back under hard caps (32 tokens per array and
 * 64 KiB serialized, see `occurrence-projection.ts`): an unbounded fingerprint
 * would be accepted, hashed, and persisted, and then silently VANISH from
 * every occurrence API response — grouping the project by evidence nobody can
 * inspect. An input outside these bounds is therefore ignored outright (the
 * occurrence falls back to default grouping), which is at least observable in
 * the provenance, instead of truncated (which would group on an arbitrary
 * prefix of what the customer asked for).
 */
export const MAX_GROUPING_FINGERPRINT_TOKENS = 32;
export const MAX_GROUPING_FINGERPRINT_TOKEN_BYTES = 512;
const FINGERPRINT_TEXT_ENCODER = new TextEncoder();

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length > MAX_GROUPING_FINGERPRINT_TOKENS) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    if (FINGERPRINT_TEXT_ENCODER.encode(item).byteLength > MAX_GROUPING_FINGERPRINT_TOKEN_BYTES) return undefined;
    result.push(item);
  }
  return result;
}

/**
 * Projects the two currently-supported wire representations into one
 * grouping-only field. A flat SDK event's scalar `fingerprint` is deliberately
 * ignored: that field is the SDK's local deduplication key, not a Sentry-style
 * custom fingerprint. The rich envelope's array-shaped `fingerprint` is the
 * canonical exception to that rule.
 */
export function readGroupingFingerprint(data: unknown): readonly string[] | undefined {
  const override = readStringArray(readField(data, "fingerprint_override"));
  if (override !== undefined) return override;
  return readStringArray(readField(data, "fingerprint"));
}

/**
 * Sentry classifies one default token (and an omitted/empty list) as default;
 * any default token mixed with another value is hybrid; everything else is a
 * custom fingerprint. The distinction matters because hybrid fingerprints
 * retain the active default hash as one component.
 */
export function classifyGroupingFingerprint(fingerprint: readonly string[] | undefined): GroupingFingerprintType {
  if (fingerprint === undefined || fingerprint.length === 0) return "default";

  let hasDefault = false;
  for (const value of fingerprint) {
    if (parseTokenName(value) === "default") hasDefault = true;
  }

  if (!hasDefault) return "custom";
  return fingerprint.length === 1 ? "default" : "hybrid";
}

/**
 * Resolves the documented tokens without touching the raw event payload. The
 * `stack` token is a normalized frame projection (no line/column or raw URL),
 * so opting into it does not reintroduce deploy-specific churn that the default
 * grouping algorithm deliberately avoids.
 */
export function resolveGroupingFingerprint(
  fingerprint: readonly string[] | undefined,
  input: GroupingInput,
  frames: readonly ParsedFrame[],
): GroupingFingerprintResolution {
  const tokens = fingerprint === undefined ? [] : [...fingerprint];
  const type = classifyGroupingFingerprint(fingerprint);
  const resolvedValues: string[] = [];

  for (const token of tokens) {
    const name = parseTokenName(token);
    if (name === null) {
      resolvedValues.push(token);
      continue;
    }
    if (name === "default") continue;
    resolvedValues.push(resolveToken(name, token, input, frames));
  }

  return {
    resolvedValues,
    provenance: {
      type,
      source: type === "default" ? "default" : "event",
      tokens,
      resolvedTokens: [...resolvedValues],
    },
  };
}

function parseTokenName(value: string): GroupingFingerprintTokenName | null {
  const match = /^\{\{\s*([^{}\s]+)\s*\}\}$/.exec(value);
  if (match === null) return null;

  const name = match[1];
  if (!isGroupingFingerprintTokenName(name)) {
    throw new Error(`Unsupported grouping fingerprint token ${JSON.stringify(value)}`);
  }
  return name;
}

function isGroupingFingerprintTokenName(value: string): value is GroupingFingerprintTokenName {
  return GROUPING_FINGERPRINT_TOKENS.some((token) => token.slice(3, -3).trim() === value);
}

function resolveToken(
  name: GroupingFingerprintTokenName,
  originalToken: string,
  input: GroupingInput,
  frames: readonly ParsedFrame[],
): string {
  switch (name) {
    case "type": {
      return input.type;
    }
    case "message": {
      return parameterizeMessage(input.message);
    }
    case "stack": {
      return normalizedStackValue(frames);
    }
    case "stack.function": {
      return frames.at(-1)?.function ?? "<no-stack-function>";
    }
    case "stack.filename": {
      return frames.at(-1)?.filename ?? "<no-stack-filename>";
    }
    case "stack.abs_path": {
      return frames.at(-1)?.absPath ?? "<no-stack-abs-path>";
    }
    case "stack.module": {
      return frames.at(-1)?.module ?? "<no-stack-module>";
    }
    case "default": {
      // `default` is consumed by the loop above. Keeping this branch makes the
      // switch exhaustive if the vocabulary grows and prevents an accidental
      // empty value from becoming a valid custom component.
      throw new Error(`Unexpected default grouping fingerprint token ${JSON.stringify(originalToken)}`);
    }
  }
}

function normalizedStackValue(frames: readonly ParsedFrame[]): string {
  return JSON.stringify(frames.map((frame) => [
    frame.module ?? frame.filename ?? "<no-stack-filename>",
    frame.function ?? "<no-stack-function>",
    frame.inApp ? "app" : "system",
  ]));
}
