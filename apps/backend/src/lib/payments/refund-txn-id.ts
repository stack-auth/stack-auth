export const REFUND_TXN_PREFIX = "refund:";

/**
 * The set of source-transaction id prefixes that the refund flow can target.
 * Pinned here so the LIKE-pattern safety invariant in `readPriorRefundSummary`
 * and the listing route is testable: none of these may contain LIKE
 * metacharacters (% / _ / \). If a future source format is added, the test
 * below will fail loud rather than silently producing false-positive matches.
 */
export const REFUND_SOURCE_TXN_PREFIXES = [
  "sub-start:",
  "sub-renewal:",
  "otp:",
] as const;

/**
 * Parse a refund txnId of shape `refund:<sourceTxnId>:<uuid>`. The sourceTxnId
 * itself may contain colons (e.g. `sub-start:abc`), so we strip the leading
 * `refund:` and the trailing `:<uuid>`. Returns null for non-refund ids.
 */
export function parseRefundTxnId(txnId: string): { sourceTxnId: string, uuid: string } | null {
  if (!txnId.startsWith(REFUND_TXN_PREFIX)) return null;
  const rest = txnId.slice(REFUND_TXN_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const sourceTxnId = rest.slice(0, lastColon);
  const uuid = rest.slice(lastColon + 1);
  if (sourceTxnId.length === 0 || uuid.length === 0) return null;
  return { sourceTxnId, uuid };
}

import.meta.vitest?.describe("parseRefundTxnId", (test) => {
  test("parses a refund txn id with a colon-containing source", ({ expect }) => {
    const parsed = parseRefundTxnId("refund:sub-start:abc-123:550e8400-e29b-41d4-a716-446655440000");
    expect(parsed).toEqual({
      sourceTxnId: "sub-start:abc-123",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
  test("parses an OTP refund txn id", ({ expect }) => {
    const parsed = parseRefundTxnId("refund:otp:abc:550e8400-e29b-41d4-a716-446655440000");
    expect(parsed).toEqual({
      sourceTxnId: "otp:abc",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
  test("returns null for non-refund txn ids", ({ expect }) => {
    expect(parseRefundTxnId("sub-start:abc")).toBeNull();
    expect(parseRefundTxnId("otp:abc")).toBeNull();
  });
});

import.meta.vitest?.describe("REFUND_SOURCE_TXN_PREFIXES", (test) => {
  test("contains no SQL LIKE metacharacters (the LIKE-safety invariant for readPriorRefundSummary)", ({ expect }) => {
    for (const prefix of REFUND_SOURCE_TXN_PREFIXES) {
      expect(prefix).not.toMatch(/[%_\\]/);
    }
  });
});
