import { describe, expect, it } from "vitest";
import {
  compareRankedIssues,
  decodeIssueCursor,
  decodeOccurrenceCursor,
  deriveSubstatus,
  encodeIssueCursor,
  encodeOccurrenceCursor,
} from "./issue-queries";

const ISSUE_A = "00000000-0000-4000-8000-000000000001";
const ISSUE_B = "00000000-0000-4000-8000-000000000002";

describe("issue list cursors", () => {
  it("round-trips the ordered column and direction with the opaque cursor", () => {
    const cursor = {
      lastSeenAtMillis: 1_754_502_400_000,
      id: ISSUE_A,
      sort: "first_seen" as const,
      sortDir: "asc" as const,
    };

    const encoded = encodeIssueCursor(cursor);

    expect(decodeIssueCursor(encoded, { sort: "first_seen", sortDir: "asc" })).toEqual(cursor);
    expect(decodeIssueCursor(encoded, { sort: "last_seen", sortDir: "asc" })).toBe(null);
    expect(decodeIssueCursor(encoded, { sort: "first_seen", sortDir: "desc" })).toBe(null);
  });

  it("continues to read legacy cursors while rejecting malformed values", () => {
    const legacy = encodeIssueCursor({ lastSeenAtMillis: 1_754_502_400_000, id: ISSUE_A });
    expect(decodeIssueCursor(legacy, { sort: "last_seen", sortDir: "desc" })).toEqual({
      lastSeenAtMillis: 1_754_502_400_000,
      id: ISSUE_A,
    });

    const tooFarInTheFuture = Buffer.from(JSON.stringify({
      lastSeenAtMillis: 8_640_000_000_000_001,
      id: ISSUE_A,
    }), "utf8").toString("base64url");
    const wrongId = Buffer.from(JSON.stringify({
      lastSeenAtMillis: 1_754_502_400_000,
      id: "not-an-issue-id",
    }), "utf8").toString("base64url");

    expect(decodeIssueCursor("not-a-cursor")).toBe(null);
    expect(decodeIssueCursor(tooFarInTheFuture)).toBe(null);
    expect(decodeIssueCursor(wrongId)).toBe(null);
  });
});

describe("occurrence cursors", () => {
  it("round-trips valid positions and rejects non-finite/out-of-range positions", () => {
    const cursor = { eventAtMillis: 1_754_502_400_000, occurrenceId: "a".repeat(64) };
    expect(decodeOccurrenceCursor(encodeOccurrenceCursor(cursor))).toEqual(cursor);

    const negative = Buffer.from(JSON.stringify({ eventAtMillis: -1, occurrenceId: "a" }), "utf8").toString("base64url");
    const tooLarge = Buffer.from(JSON.stringify({ eventAtMillis: 8_640_000_000_000_001, occurrenceId: "a" }), "utf8").toString("base64url");
    const emptyId = Buffer.from(JSON.stringify({ eventAtMillis: 1, occurrenceId: "" }), "utf8").toString("base64url");

    expect(decodeOccurrenceCursor(negative)).toBe(null);
    expect(decodeOccurrenceCursor(tooLarge)).toBe(null);
    expect(decodeOccurrenceCursor(emptyId)).toBe(null);
  });
});

describe("issue search ordering", () => {
  const left = {
    id: ISSUE_A,
    window_occurrences: 10,
    window_users: 3,
    last_seen_at_millis: 1_754_502_400_000,
  } as const;
  const right = {
    id: ISSUE_B,
    window_occurrences: 10,
    window_users: 3,
    last_seen_at_millis: 1_754_502_400_000,
  } as const;

  it("uses stable time and id tie-breakers for window-ranked results", () => {
    expect(compareRankedIssues(left, right, "events", "desc")).toBeGreaterThan(0);
    expect(compareRankedIssues(left, right, "events", "asc")).toBeLessThan(0);
  });
});

describe("issue substatus", () => {
  const rangeStart = new Date("2026-08-06T00:00:00.000Z");

  it("is derived from the selected window rather than persisted state", () => {
    expect(deriveSubstatus({ firstSeenAt: new Date("2026-08-06T01:00:00.000Z"), regressedAt: null }, rangeStart)).toBe("new");
    expect(deriveSubstatus({ firstSeenAt: new Date("2026-08-01T01:00:00.000Z"), regressedAt: new Date("2026-08-06T02:00:00.000Z") }, rangeStart)).toBe("regressed");
    expect(deriveSubstatus({ firstSeenAt: new Date("2026-08-01T01:00:00.000Z"), regressedAt: null }, rangeStart)).toBe("ongoing");
  });
});
