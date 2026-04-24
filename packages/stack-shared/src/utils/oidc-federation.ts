import type { JWTPayload } from "jose";

export type ClaimConditions = {
  stringEquals?: Map<string, string | string[]>,
  stringLike?: Map<string, string | string[]>,
};

export const MAX_GLOB_PATTERN_LENGTH = 1024;
export const MAX_CLAIM_VALUE_LENGTH = 4096;

// Linear-time glob match. Avoids regex backtracking on admin-supplied patterns like
// `*a*b*c*d*` that would translate to `.*a.*b.*c.*d.*` and blow up on near-miss inputs.
// `*` matches any (including empty) sequence; `?` matches exactly one character.
export function stringLikeMatch(pattern: string, value: string): boolean {
  if (pattern.length > MAX_GLOB_PATTERN_LENGTH) return false;
  if (value.length > MAX_CLAIM_VALUE_LENGTH) return false;
  let pi = 0, vi = 0;
  let starPi = -1, starVi = -1;
  while (vi < value.length) {
    const pc = pi < pattern.length ? pattern[pi] : undefined;
    if (pc === "*") {
      starPi = pi++;
      starVi = vi;
    } else if (pc === "?" || pc === value[vi]) {
      pi++;
      vi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      vi = ++starVi;
    } else {
      return false;
    }
  }
  while (pi < pattern.length && pattern[pi] === "*") pi++;
  return pi === pattern.length;
}

type ClaimScalar = { kind: "scalar", value: string };
type ClaimArray = { kind: "array", values: string[] };
type ClaimMissing = { kind: "missing" };
type ClaimUnsupported = { kind: "unsupported" };
type NormalizedClaim = ClaimScalar | ClaimArray | ClaimMissing | ClaimUnsupported;

function normalizeClaim(value: JWTPayload[string]): NormalizedClaim {
  if (value == null) return { kind: "missing" };
  if (typeof value === "string") return { kind: "scalar", value };
  if (typeof value === "number" || typeof value === "boolean") return { kind: "scalar", value: String(value) };
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      if (typeof v === "string") out.push(v);
      else if (typeof v === "number" || typeof v === "boolean") out.push(String(v));
      // Silently drop nested objects within the array — they can't match a string condition.
    }
    return { kind: "array", values: out };
  }
  return { kind: "unsupported" };
}

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

export type MatchResult =
  | { matched: true }
  | { matched: false, reason: string };

type ClaimValuesResult =
  | { kind: "values", values: string[] }
  | { kind: "error", reason: string };

function claimValues(claim: NormalizedClaim, claimKey: string): ClaimValuesResult {
  if (claim.kind === "missing") return { kind: "error", reason: `missing claim "${claimKey}"` };
  if (claim.kind === "unsupported") return { kind: "error", reason: `claim "${claimKey}" is an object, which cannot be matched against string conditions` };
  return { kind: "values", values: claim.kind === "array" ? claim.values : [claim.value] };
}

export function matchClaims(conditions: ClaimConditions, claims: JWTPayload): MatchResult {
  for (const [claimKey, expected] of conditions.stringEquals ?? new Map()) {
    const result = claimValues(normalizeClaim(claims[claimKey]), claimKey);
    if (result.kind === "error") return { matched: false, reason: result.reason };
    const options = toArray(expected);
    if (!result.values.some(v => options.includes(v))) {
      return { matched: false, reason: `stringEquals failed on claim "${claimKey}"` };
    }
  }
  for (const [claimKey, expected] of conditions.stringLike ?? new Map()) {
    const result = claimValues(normalizeClaim(claims[claimKey]), claimKey);
    if (result.kind === "error") return { matched: false, reason: result.reason };
    const options = toArray(expected);
    const anyMatch = result.values.some(v => options.some(pattern => stringLikeMatch(pattern, v)));
    if (!anyMatch) {
      return { matched: false, reason: `stringLike failed on claim "${claimKey}"` };
    }
  }
  return { matched: true };
}
