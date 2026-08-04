import { describe, expect, it } from "vitest";
import { OBSERVABILITY_TIME_RANGES } from "../filters";
import {
  buildIssueListQueryString,
  getIssueFacetsQuery,
  getIssueSparklineQuery,
  parseIssueFacetRows,
  parseIssueSparklineRows,
  type IssueListRequest,
} from "./issues-data";

const SAMPLE_HASH_A = "0123456789abcdef0123456789abcdef";
const SAMPLE_HASH_B = "fedcba9876543210fedcba9876543210";

describe("getIssueSparklineQuery", () => {
  it("binds the hashes as a parameter instead of interpolating them", () => {
    const { query, params } = getIssueSparklineQuery(24, [SAMPLE_HASH_A, SAMPLE_HASH_B]);
    expect(query).toContain("issue_hash IN {issueHashes:Array(String)}");
    expect(query).not.toContain(SAMPLE_HASH_A);
    expect(params.issueHashes).toEqual([SAMPLE_HASH_A, SAMPLE_HASH_B]);
  });

  it("reads the errors view and bounds the scan by the selected range", () => {
    expect(getIssueSparklineQuery(24, [SAMPLE_HASH_A]).query).toContain("FROM default.errors");
    for (const range of OBSERVABILITY_TIME_RANGES) {
      expect(getIssueSparklineQuery(range.hours, [SAMPLE_HASH_A]).query)
        .toContain(`event_at >= now64(3) - INTERVAL ${range.hours} HOUR`);
    }
  });

  it("throws for an hours value outside the shared range set", () => {
    expect(() => getIssueSparklineQuery(3, [SAMPLE_HASH_A])).toThrow(/Unknown issues time range/);
    expect(() => getIssueSparklineQuery(0, [SAMPLE_HASH_A])).toThrow(/Unknown issues time range/);
  });

  it("refuses to build a query for zero hashes, which would scan every error", () => {
    expect(() => getIssueSparklineQuery(24, [])).toThrow(/zero hashes/);
  });
});

describe("getIssueFacetsQuery", () => {
  it("groups services and environments together in one query", () => {
    const { query } = getIssueFacetsQuery(168);
    expect(query).toContain("FROM default.errors");
    expect(query).toContain("GROUP BY service_namespace, service_name, deployment_environment_name");
    expect(query).toContain("event_at >= now64(3) - INTERVAL 168 HOUR");
  });

  it("throws for an unknown range", () => {
    expect(() => getIssueFacetsQuery(999)).toThrow(/Unknown issues time range/);
  });
});

describe("parseIssueSparklineRows", () => {
  it("returns an empty series for a requested hash with no occurrences", () => {
    const parsed = parseIssueSparklineRows([], [SAMPLE_HASH_A, SAMPLE_HASH_B]);
    expect(parsed.get(SAMPLE_HASH_A)).toEqual([]);
    expect(parsed.get(SAMPLE_HASH_B)).toEqual([]);
  });

  it("parses ClickHouse timestamps as UTC and string counts as numbers", () => {
    const parsed = parseIssueSparklineRows(
      [{ issue_hash: SAMPLE_HASH_A, bucket_start: "2026-07-31 12:00:00.000", occurrences: "17" }],
      [SAMPLE_HASH_A],
    );
    expect(parsed.get(SAMPLE_HASH_A)).toEqual([
      { bucketMs: Date.parse("2026-07-31T12:00:00.000Z"), occurrences: 17 },
    ]);
  });

  it("throws when a row carries a hash nobody asked for", () => {
    expect(() => parseIssueSparklineRows(
      [{ issue_hash: SAMPLE_HASH_B, bucket_start: "2026-07-31 12:00:00.000", occurrences: 1 }],
      [SAMPLE_HASH_A],
    )).toThrow(/unrequested issue hash/);
  });
});

describe("parseIssueFacetRows", () => {
  it("de-duplicates services and drops empty environments", () => {
    const facets = parseIssueFacetRows([
      { service_namespace: null, service_name: "web", deployment_environment_name: "production" },
      { service_namespace: null, service_name: "web", deployment_environment_name: "staging" },
      { service_namespace: null, service_name: "", deployment_environment_name: "" },
    ]);
    expect(facets.services).toHaveLength(1);
    expect(facets.environments).toEqual(["production", "staging"]);
  });
});

describe("buildIssueListQueryString", () => {
  const request: IssueListRequest = {
    hours: 24,
    status: "unresolved",
    service: null,
    environment: null,
    handled: "all",
    search: "",
    sort: "last_seen",
    sortDir: "desc",
    cursor: null,
    limit: 50,
  };

  it("sends the filter values the endpoint's parsers actually accept", () => {
    const params = new URLSearchParams(buildIssueListQueryString({
      ...request,
      status: "all",
      handled: "unhandled",
      environment: "staging",
    }));
    // `all` is a real value for both, not "omit the param": the endpoint's
    // parseStatus/parseHandled accept it, and sending "true"/"false" for
    // `handled` (an easy guess) is a 400.
    expect(params.get("status")).toBe("all");
    expect(params.get("handled")).toBe("unhandled");
    expect(params.get("environment")).toBe("staging");
    expect(params.get("hours")).toBe("24");
    expect(params.get("sort")).toBe("last_seen");
    expect(params.get("sort_dir")).toBe("desc");
  });

  it("narrows a namespaced service identity to the name the endpoint filters on", () => {
    const params = new URLSearchParams(buildIssueListQueryString({
      ...request,
      service: { namespace: "backend", name: "api" },
    }));
    expect(params.get("service")).toBe("api");
    expect(params.get("service_namespace")).toBeNull();
  });

  it("never asks for more than the server's page size", () => {
    const params = new URLSearchParams(buildIssueListQueryString({ ...request, limit: 5000 }));
    expect(params.get("limit")).toBe("50");
  });

  it("omits an empty search rather than sending a blank filter", () => {
    expect(new URLSearchParams(buildIssueListQueryString(request)).get("search")).toBeNull();
    expect(new URLSearchParams(buildIssueListQueryString({ ...request, search: "boom" })).get("search")).toBe("boom");
  });
});
