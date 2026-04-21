import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";

type TrustPoliciesMap = NonNullable<NonNullable<CompleteConfig["oidcFederation"]>["trustPolicies"]>;
export type TrustPolicy = NonNullable<TrustPoliciesMap[string]>;
export type ClaimValueRecord = NonNullable<NonNullable<TrustPolicy["claimConditions"]["stringEquals"]>[string]>;

export type ClaimOperator = "equals" | "like";
export type ClaimRow = {
  rowId: string,
  claim: string,
  operator: ClaimOperator,
  valuesRaw: string,
  persistedValueIds?: string[],
};

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
  claimRows: ClaimRow[],
  tokenTtlSeconds: number,
};

export function emptyDraft(): PolicyDraft {
  return {
    id: "",
    displayName: "",
    enabled: true,
    issuerUrl: "",
    audiences: [{ rowId: generateUuid(), value: "" }],
    claimRows: [],
    tokenTtlSeconds: 900,
  };
}

export function newClaimRow(operator: ClaimOperator = "equals"): ClaimRow {
  return { rowId: generateUuid(), claim: "", operator, valuesRaw: "", persistedValueIds: [] };
}

export function newAudienceRow(value = "", persistedId?: string): AudienceRow {
  return { rowId: generateUuid(), value, persistedId };
}

function parseValueLines(raw: string): string[] {
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function valuesToRecord(values: Array<{ value: string, persistedId?: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  const usedIds = new Set<string>();
  for (const { value, persistedId } of values) {
    const id = persistedId != null && !usedIds.has(persistedId) ? persistedId : generateUuid();
    usedIds.add(id);
    out[id] = value;
  }
  return out;
}

type ParsedClaimRow = {
  claim: string,
  operator: ClaimOperator,
  values: Array<{ value: string, persistedId?: string }>,
};

export function parseClaimRow(row: ClaimRow): ParsedClaimRow | null {
  const claim = row.claim.trim();
  if (!claim) return null;
  const values = parseValueLines(row.valuesRaw);
  if (values.length === 0) return null;
  return {
    claim,
    operator: row.operator,
    values: values.map((value, index) => ({ value, persistedId: row.persistedValueIds?.[index] })),
  };
}

export function groupClaimsByName(rows: ParsedClaimRow[]): Record<string, ClaimValueRecord> {
  const byClaim: Record<string, Array<{ value: string, persistedId?: string }>> = {};
  for (const row of rows) {
    (byClaim[row.claim] ??= []).push(...row.values);
  }
  return Object.fromEntries(Object.entries(byClaim).map(([k, vs]) => [k, valuesToRecord(vs)]));
}

export function draftToPolicy(draft: PolicyDraft): TrustPolicy {
  const audienceValues = draft.audiences
    .map((audience) => ({ value: audience.value.trim(), persistedId: audience.persistedId }))
    .filter((audience) => audience.value !== "");

  const parsed = draft.claimRows.map(parseClaimRow).filter((r): r is ParsedClaimRow => r !== null);
  const byOperator = (op: ClaimOperator) => groupClaimsByName(parsed.filter(r => r.operator === op));

  return {
    displayName: draft.displayName.trim(),
    enabled: draft.enabled,
    issuerUrl: draft.issuerUrl.trim(),
    audiences: valuesToRecord(audienceValues),
    claimConditions: {
      stringEquals: byOperator("equals"),
      stringLike: byOperator("like"),
    },
    tokenTtlSeconds: draft.tokenTtlSeconds,
  };
}

export function policyToDraft(id: string, policy: TrustPolicy): PolicyDraft {
  const audiences = Object.entries(policy.audiences ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([persistedId, value]) => newAudienceRow(value, persistedId));

  const collectRows = (operator: ClaimOperator, record: Record<string, ClaimValueRecord | undefined> | undefined): ClaimRow[] => {
    if (!record) return [];
    return Object.entries(record).flatMap(([claim, valueRecord]) => {
      const values = Object.entries(valueRecord ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
      if (values.length === 0) return [];
      return [{
        rowId: generateUuid(),
        claim,
        operator,
        valuesRaw: values.map(([_, value]) => value).join("\n"),
        persistedValueIds: values.map(([persistedId]) => persistedId),
      }];
    });
  };

  return {
    id,
    displayName: policy.displayName ?? "",
    enabled: policy.enabled,
    issuerUrl: policy.issuerUrl ?? "",
    audiences: audiences.length > 0 ? audiences : [newAudienceRow()],
    claimRows: [
      ...collectRows("equals", policy.claimConditions.stringEquals),
      ...collectRows("like", policy.claimConditions.stringLike),
    ],
    tokenTtlSeconds: policy.tokenTtlSeconds ?? 900,
  };
}

export type DraftValidationIssue =
  | { kind: "missing-display-name" }
  | { kind: "missing-issuer" }
  | { kind: "missing-audiences" }
  | { kind: "invalid-ttl" };

export function validateDraft(draft: PolicyDraft): DraftValidationIssue[] {
  const issues: DraftValidationIssue[] = [];
  if (!draft.displayName.trim()) issues.push({ kind: "missing-display-name" });
  if (!draft.issuerUrl.trim()) issues.push({ kind: "missing-issuer" });
  if (draft.audiences.every(a => !a.value.trim())) issues.push({ kind: "missing-audiences" });
  if (!Number.isFinite(draft.tokenTtlSeconds) || draft.tokenTtlSeconds < 30 || draft.tokenTtlSeconds > 3600) {
    issues.push({ kind: "invalid-ttl" });
  }
  return issues;
}

export type DiscoveryProbeResult =
  | { kind: "ok", issuer: string, jwksUri: string }
  | { kind: "error", reason: string };

export async function probeIssuerDiscovery(issuerUrl: string, options?: { fetchImpl?: typeof fetch }): Promise<DiscoveryProbeResult> {
  const trimmed = issuerUrl.trim();
  if (!trimmed) return { kind: "error", reason: "issuer URL is empty" };
  let url: URL;
  try {
    url = new URL(`${trimmed.replace(/\/$/, "")}/.well-known/openid-configuration`);
  } catch {
    return { kind: "error", reason: "issuer URL is not a valid URL" };
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url.toString(), { method: "GET", headers: { accept: "application/json" } });
    if (!response.ok) {
      return { kind: "error", reason: `HTTP ${response.status} from ${url.toString()}` };
    }
    const body = await response.json() as { issuer?: unknown, jwks_uri?: unknown };
    if (typeof body.issuer !== "string") return { kind: "error", reason: "discovery doc missing `issuer`" };
    if (typeof body.jwks_uri !== "string") return { kind: "error", reason: "discovery doc missing `jwks_uri`" };
    return { kind: "ok", issuer: body.issuer, jwksUri: body.jwks_uri };
  } catch (e) {
    return { kind: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}
