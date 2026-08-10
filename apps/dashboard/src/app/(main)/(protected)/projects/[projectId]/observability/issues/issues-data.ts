import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import {
  IssueDetailResponseSchema,
  IssueListResponseSchema,
  ISSUE_LIST_PAGE_SIZE,
  type IssueDetailResponse,
  type IssueFrame,
  type IssueListResponse,
  type IssueListSortField,
  type IssueOccurrence,
  type IssueStatus,
} from "@hexclave/shared/dist/interface/admin-issues";
import * as yup from "yup";
import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import { getBucketGranularity } from "../bucket-granularity";
import { isObservabilityTimeRangeHours, type ObservabilityTimeRangeHours } from "../filters";
import { parseServiceIdentityRow, type ServiceIdentity } from "../service-identity";

/**
 * The Issues data layer: the REST calls to `/internal/issues*` and the two
 * ClickHouse queries the list page owns directly.
 *
 * Types and runtime validation both come from `@hexclave/shared`'s
 * `admin-issues.ts`, which the backend routes also import — so there is exactly
 * one description of these shapes and no way for the dashboard's idea of an
 * issue to drift from the API's. Responses are `validate`d rather than cast:
 * an `undefined` `times_seen` renders as a plausible-looking dash and nobody
 * ever notices, whereas a validation error names the offending field.
 *
 * These calls go through `sendInternalAdminRequest` (the existing escape hatch
 * for internal dashboard endpoints, same as `/internal/metrics`) because the
 * routes are not exposed as typed `adminApp` methods.
 */

export type {
  IssueDetailResponse,
  IssueFrame,
  IssueListItem,
  IssueListResponse,
  IssueListSortField,
  IssueOccurrence,
  IssueStatus,
  IssueSubstatus,
} from "@hexclave/shared/dist/interface/admin-issues";

export { ISSUE_LIST_PAGE_SIZE } from "@hexclave/shared/dist/interface/admin-issues";

export type IssueStatusCounts = IssueListResponse["counts"];

/**
 * The stored statuses, as a list. `IssueStatusSchema` describes them as a yup
 * `oneOf`, which is the right shape for validation and the wrong one for
 * building a tab bar; typing the array as `IssueStatus[]` means adding a status
 * to the schema without adding it here is a compile error at every use site.
 */
export const ISSUE_STATUSES: readonly IssueStatus[] = ["unresolved", "resolved", "ignored"];

/** Occurrence navigation direction, as the detail route's `direction` param. */
export type IssueOccurrenceDirection = "newer" | "older";

export type IssueHandledFilter = "all" | "handled" | "unhandled";

export type IssueListRequest = {
  hours: ObservabilityTimeRangeHours,
  /** `"all"` is a real value the endpoint understands, not "omit the filter". */
  status: IssueStatus | "all",
  service: ServiceIdentity | null,
  environment: string | null,
  handled: IssueHandledFilter,
  search: string,
  sort: IssueListSortField,
  sortDir: "asc" | "desc",
  cursor: string | null,
  limit: number,
};

// ─── ClickHouse queries owned by the list page ───────────────────────

/**
 * One occurrence-volume series per hash, for the whole visible page.
 *
 * This is deliberately a single query over every uncached hash rather than one
 * query per row: at 50 rows the per-row shape is 50 round trips for decoration,
 * which is the failure mode this column exists in spite of. The hashes ride as
 * a bound `Array(String)` parameter — they are server-generated hex, but
 * building an `IN` list by interpolation is a habit that eventually meets a
 * value that isn't.
 */
export function getIssueSparklineQuery(
  hours: number,
  hashes: readonly string[],
): { query: string, params: Record<string, string | number | string[]> } {
  if (!isObservabilityTimeRangeHours(hours)) {
    throw new Error(`Unknown issues time range: ${hours}`);
  }
  if (hashes.length === 0) {
    throw new Error("Refusing to build a sparkline query for zero hashes");
  }
  const granularity = getBucketGranularity(hours);
  return {
    query: `
SELECT
  issue_hash,
  toStartOfInterval(event_at, ${granularity.stepSql}) AS bucket_start,
  count() AS occurrences
FROM default.errors
WHERE event_at >= now64(3) - INTERVAL ${hours} HOUR
  AND issue_hash IN {issueHashes:Array(String)}
GROUP BY issue_hash, bucket_start
ORDER BY issue_hash ASC, bucket_start ASC
`,
    params: { issueHashes: [...hashes] },
  };
}

/**
 * Distinct service / environment pairs that have actually produced an error in
 * the window. Sourced from the occurrences themselves so the dropdowns can
 * never offer a filter that empties the list.
 *
 * One query for both facets: the pairs are what ClickHouse has, and the
 * cardinality is small enough that splitting it into two GROUP BYs would cost a
 * second round trip to save nothing.
 */
export function getIssueFacetsQuery(hours: number): { query: string, params: Record<string, string> } {
  if (!isObservabilityTimeRangeHours(hours)) {
    throw new Error(`Unknown issues time range: ${hours}`);
  }
  return {
    query: `
SELECT
  service_namespace,
  service_name,
  deployment_environment_name
FROM default.errors
WHERE event_at >= now64(3) - INTERVAL ${hours} HOUR
GROUP BY service_namespace, service_name, deployment_environment_name
ORDER BY service_namespace ASC, service_name ASC, deployment_environment_name ASC
LIMIT 500
`,
    params: {},
  };
}

export type IssueSparklineBucket = { bucketMs: number, occurrences: number };
export type IssueFacets = { services: ServiceIdentity[], environments: string[] };

function parseClickHouseUtc(value: unknown, key: string): number {
  if (typeof value !== "string") {
    throw new HexclaveAssertionError(`Expected ${key} to be a ClickHouse timestamp string`);
  }
  const trimmed = value.trim();
  const normalized = trimmed.replace(" ", "T") + (trimmed.includes("Z") || trimmed.includes("+") ? "" : "Z");
  const millis = new Date(normalized).getTime();
  if (Number.isNaN(millis)) throw new HexclaveAssertionError(`Invalid ${key}: ${value}`);
  return millis;
}

function toCount(value: unknown, key: string): number {
  // ClickHouse returns UInt64 aggregates as strings.
  const count = typeof value === "string" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw new HexclaveAssertionError(`Expected ${key} to be a count, got ${String(value)}`);
  }
  return count;
}

export function parseIssueSparklineRows(
  rows: readonly Record<string, unknown>[],
  requestedHashes: readonly string[],
): Map<string, IssueSparklineBucket[]> {
  // Every requested hash gets an entry, including hashes with no occurrences in
  // the window. Without that the row would stay in its "pending" state forever
  // and read as "still loading" rather than "nothing happened here".
  const byHash = new Map<string, IssueSparklineBucket[]>(
    requestedHashes.map((hash) => [hash, []]),
  );
  for (const row of rows) {
    const hash = row.issue_hash;
    if (typeof hash !== "string") {
      throw new HexclaveAssertionError("Expected sparkline row issue_hash to be a string");
    }
    const bucket = {
      bucketMs: parseClickHouseUtc(row.bucket_start, "sparkline bucket_start"),
      occurrences: toCount(row.occurrences, "sparkline occurrences"),
    };
    const existing = byHash.get(hash);
    if (existing == null) {
      // A hash we didn't ask for means the query and the cache key disagree.
      throw new HexclaveAssertionError(`Sparkline row returned an unrequested issue hash: ${hash}`);
    }
    existing.push(bucket);
  }
  return byHash;
}

export function parseIssueFacetRows(rows: readonly Record<string, unknown>[]): IssueFacets {
  const services = new Map<string, ServiceIdentity>();
  const environments = new Set<string>();
  for (const row of rows) {
    const name = row.service_name;
    if (typeof name === "string" && name !== "") {
      const identity = parseServiceIdentityRow(row);
      services.set(`${identity.namespace}${identity.name}`, identity);
    }
    const environment = row.deployment_environment_name;
    if (typeof environment === "string" && environment !== "") environments.add(environment);
  }
  return {
    services: [...services.values()],
    environments: [...environments].sort(stringCompare),
  };
}

// ─── REST calls ──────────────────────────────────────────────────────

export function buildIssueListQueryString(request: IssueListRequest): string {
  const params = new URLSearchParams();
  params.set("hours", String(request.hours));
  params.set("status", request.status);
  // The endpoint filters on the service NAME only; namespace is a dashboard-side
  // display concern, so a namespaced identity narrows to its name here.
  if (request.service != null) params.set("service", request.service.name);
  if (request.environment != null) params.set("environment", request.environment);
  params.set("handled", request.handled);
  if (request.search !== "") params.set("search", request.search);
  params.set("sort", request.sort);
  params.set("sort_dir", request.sortDir);
  if (request.cursor != null) params.set("cursor", request.cursor);
  params.set("limit", String(Math.min(request.limit, ISSUE_LIST_PAGE_SIZE)));
  return params.toString();
}

async function readJsonOrThrow(response: Response, what: string): Promise<unknown> {
  if (!response.ok) {
    // Deliberately does not surface the upstream body: this is an admin
    // endpoint, but the dashboard still shouldn't render whatever a 5xx
    // happened to include. The status is what the reader can act on.
    throw new HexclaveAssertionError(`${what} failed with status ${response.status}`);
  }
  return await response.json();
}

export async function fetchIssueList(adminApp: object, request: IssueListRequest): Promise<IssueListResponse> {
  const response = await sendInternalAdminRequest(
    adminApp,
    `/internal/issues?${buildIssueListQueryString(request)}`,
    { method: "GET" },
  );
  return await IssueListResponseSchema.validate(await readJsonOrThrow(response, "Loading issues"));
}

export async function fetchIssueDetail(
  adminApp: object,
  idOrShortId: string,
  options: { occurrence?: string, direction?: IssueOccurrenceDirection } = {},
): Promise<IssueDetailResponse> {
  const params = new URLSearchParams();
  if (options.occurrence != null) params.set("occurrence", options.occurrence);
  // The direction is what turns one cursor into two buttons: the same
  // `(event_at, occurrence_id)` cursor means "the one before" or "the one
  // after" depending on it, so sending only the cursor always steps older.
  if (options.direction != null) params.set("direction", options.direction);
  const search = params.toString();
  const response = await sendInternalAdminRequest(
    adminApp,
    `/internal/issues/${encodeURIComponent(idOrShortId)}${search === "" ? "" : `?${search}`}`,
    { method: "GET" },
  );
  return await IssueDetailResponseSchema.validate(await readJsonOrThrow(response, "Loading issue"));
}

/**
 * The PATCH response is deliberately just `{ id, status }` — the endpoint does
 * not recompute the window-scoped metrics for one status change, so there is no
 * fresh `IssueListItem` to return. That is exactly why the list's optimistic
 * override is versioned against `updated_at_millis` instead of being replaced
 * by a server row here.
 */
const IssueStatusUpdateResponseSchema = yup.object({
  id: yup.string().defined(),
  status: yup.string().oneOf<IssueStatus>(["unresolved", "resolved", "ignored"]).defined(),
}).defined();

export async function updateIssueStatus(
  adminApp: object,
  issueId: string,
  status: IssueStatus,
): Promise<{ id: string, status: IssueStatus }> {
  const response = await sendInternalAdminRequest(
    adminApp,
    `/internal/issues/${encodeURIComponent(issueId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  return await IssueStatusUpdateResponseSchema.validate(await readJsonOrThrow(response, "Updating the issue"));
}
