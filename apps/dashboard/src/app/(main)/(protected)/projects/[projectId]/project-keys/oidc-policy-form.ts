import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

type TrustPoliciesMap = NonNullable<NonNullable<CompleteConfig["oidcFederation"]>["trustPolicies"]>;
export type TrustPolicy = NonNullable<TrustPoliciesMap[string]>;
export type ClaimValueRecord = NonNullable<NonNullable<TrustPolicy["claimConditions"]["stringEquals"]>[string]>;

export type AudienceRow = {
  rowId: string,
  value: string,
  persistedId?: string,
};

export type PolicyDraft = {
  id: string,
  displayName: string,
  enabled: boolean,
  issuerUrl: string,
  audiences: AudienceRow[],
  claimConditionsJson: string,
  tokenTtlSeconds: number,
};

type ClaimConditionsJson = {
  stringEquals?: Record<string, string[]>,
  stringLike?: Record<string, string[]>,
};

export const EMPTY_CLAIM_CONDITIONS_JSON: string = JSON.stringify({ stringEquals: {}, stringLike: {} }, null, 2);

export function emptyDraft(): PolicyDraft {
  return {
    id: "",
    displayName: "",
    enabled: true,
    issuerUrl: "",
    audiences: [{ rowId: generateUuid(), value: "" }],
    claimConditionsJson: EMPTY_CLAIM_CONDITIONS_JSON,
    tokenTtlSeconds: 900,
  };
}

export function newAudienceRow(value = "", persistedId?: string): AudienceRow {
  return { rowId: generateUuid(), value, persistedId };
}

function valuesToRecord(values: string[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const value of values) out[generateUuid()] = value;
  return out;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === "string");
}

function parseClaimSection(section: unknown): Record<string, string[]> {
  if (section === null || section === undefined) return {};
  if (typeof section !== "object") throw new Error("must be an object");
  const out: Record<string, string[]> = {};
  for (const [claim, values] of Object.entries(section as Record<string, unknown>)) {
    if (!isStringArray(values)) throw new Error(`values for claim "${claim}" must be an array of strings`);
    if (values.length > 0) out[claim] = values.filter(v => v.trim() !== "");
  }
  return out;
}

export type ParsedClaimConditions = {
  stringEquals: Record<string, string[]>,
  stringLike: Record<string, string[]>,
};

export function parseClaimConditionsJson(raw: string): { kind: "ok", parsed: ParsedClaimConditions } | { kind: "error", reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "ok", parsed: { stringEquals: {}, stringLike: {} } };
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "invalid JSON" };
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { kind: "error", reason: "top-level must be an object with `stringEquals` and/or `stringLike`" };
  }
  try {
    const stringEquals = parseClaimSection((obj as Record<string, unknown>).stringEquals);
    const stringLike = parseClaimSection((obj as Record<string, unknown>).stringLike);
    return { kind: "ok", parsed: { stringEquals, stringLike } };
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : "invalid claim conditions" };
  }
}

export function claimConditionsToJson(policy: TrustPolicy): string {
  const flatten = (record: Record<string, ClaimValueRecord | undefined> | undefined): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [claim, valueRecord] of Object.entries(record ?? {})) {
      const values = Object.values(valueRecord ?? {}).filter((v): v is string => typeof v === "string");
      if (values.length > 0) out[claim] = values;
    }
    return out;
  };
  const shaped: ClaimConditionsJson = {
    stringEquals: flatten(policy.claimConditions.stringEquals),
    stringLike: flatten(policy.claimConditions.stringLike),
  };
  return JSON.stringify(shaped, null, 2);
}

// Fail closed on invalid JSON: refuse to emit a policy with empty conditions, which would
// otherwise broaden trust silently. Callers should run `validateDraft` first; this is the
// second line of defense.
export class DraftToPolicyError extends Error {
  constructor(public readonly reason: string) {
    super(`cannot convert draft to policy: ${reason}`);
    this.name = "DraftToPolicyError";
    // Preserve `instanceof DraftToPolicyError` if this ever gets downleveled to ES5.
    Object.setPrototypeOf(this, DraftToPolicyError.prototype);
  }
}

export function draftToPolicy(draft: PolicyDraft): TrustPolicy {
  const audienceValues = draft.audiences
    .map((audience) => ({ value: audience.value.trim(), persistedId: audience.persistedId }))
    .filter((audience) => audience.value !== "");

  const audiencesRecord: Record<string, string> = Object.create(null);
  const usedAudIds = new Set<string>();
  for (const { value, persistedId } of audienceValues) {
    const id = persistedId != null && !usedAudIds.has(persistedId) ? persistedId : generateUuid();
    usedAudIds.add(id);
    audiencesRecord[id] = value;
  }

  const parseResult = parseClaimConditionsJson(draft.claimConditionsJson);
  if (parseResult.kind !== "ok") {
    throw new DraftToPolicyError(`invalid claim conditions JSON: ${parseResult.reason}`);
  }
  const parsed = parseResult.parsed;
  const toRecord = (section: Record<string, string[]>): Record<string, ClaimValueRecord> => {
    const out: Record<string, ClaimValueRecord> = Object.create(null);
    for (const [claim, values] of Object.entries(section)) out[claim] = valuesToRecord(values);
    return out;
  };

  return {
    displayName: draft.displayName.trim(),
    enabled: draft.enabled,
    issuerUrl: draft.issuerUrl.trim(),
    audiences: audiencesRecord,
    claimConditions: {
      stringEquals: toRecord(parsed.stringEquals),
      stringLike: toRecord(parsed.stringLike),
    },
    tokenTtlSeconds: draft.tokenTtlSeconds,
  };
}

export function policyToDraft(id: string, policy: TrustPolicy): PolicyDraft {
  const audiences = Object.entries(policy.audiences ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([persistedId, value]) => newAudienceRow(value, persistedId));

  return {
    id,
    displayName: policy.displayName ?? "",
    enabled: policy.enabled,
    issuerUrl: policy.issuerUrl ?? "",
    audiences: audiences.length > 0 ? audiences : [newAudienceRow()],
    claimConditionsJson: claimConditionsToJson(policy),
    tokenTtlSeconds: policy.tokenTtlSeconds ?? 900,
  };
}

export type DraftValidationIssue =
  | { kind: "missing-display-name" }
  | { kind: "missing-issuer" }
  | { kind: "missing-audiences" }
  | { kind: "invalid-ttl" }
  | { kind: "invalid-claim-conditions-json", reason: string };

export function validateDraft(draft: PolicyDraft): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  if (!draft.displayName.trim()) issues.push({ kind: "missing-display-name" });
  if (!draft.issuerUrl.trim()) issues.push({ kind: "missing-issuer" });
  if (draft.audiences.every(a => !a.value.trim())) issues.push({ kind: "missing-audiences" });
  if (!Number.isFinite(draft.tokenTtlSeconds) || draft.tokenTtlSeconds < 30 || draft.tokenTtlSeconds > 3600) {
    issues.push({ kind: "invalid-ttl" });
  }
  const parseResult = parseClaimConditionsJson(draft.claimConditionsJson);
  if (parseResult.kind === "error") {
    issues.push({ kind: "invalid-claim-conditions-json", reason: parseResult.reason });
  }
  return issues;
}

export type DiscoveryProbeResult =
  | { kind: "ok", issuer: string, jwksUri: string }
  | { kind: "error", reason: string };
