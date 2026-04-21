import type { JWTPayload } from "jose";

export type ClaimConditions = {
  stringEquals?: Record<string, string | string[]>,
  stringLike?: Record<string, string | string[]>,
};

export function stringLikeToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
}

function claimAsString(value: JWTPayload[string]): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

export type MatchResult =
  | { matched: true }
  | { matched: false, reason: string };

export function matchClaims(conditions: ClaimConditions, claims: JWTPayload): MatchResult {
  for (const [claimKey, expected] of Object.entries(conditions.stringEquals ?? {})) {
    const actual = claimAsString(claims[claimKey]);
    if (actual === undefined) return { matched: false, reason: `missing claim "${claimKey}"` };
    const options = toArray(expected);
    if (!options.includes(actual)) {
      return { matched: false, reason: `stringEquals failed on claim "${claimKey}"` };
    }
  }
  for (const [claimKey, expected] of Object.entries(conditions.stringLike ?? {})) {
    const actual = claimAsString(claims[claimKey]);
    if (actual === undefined) return { matched: false, reason: `missing claim "${claimKey}"` };
    const options = toArray(expected);
    const anyMatch = options.some(pattern => stringLikeToRegExp(pattern).test(actual));
    if (!anyMatch) {
      return { matched: false, reason: `stringLike failed on claim "${claimKey}"` };
    }
  }
  return { matched: true };
}
