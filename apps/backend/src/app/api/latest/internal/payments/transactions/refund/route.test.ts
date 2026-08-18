import { describe, expect, it } from "vitest";
import {
  getRefundDrivenImmediateEndedAt,
  recordRefundAuditAfterCommit,
  shouldRejectSubscriptionProductRevocationReplay,
} from "./route";

describe("subscription refund replay guard", () => {
  it("allows retry repair when subscription marker exists but refund revocation row is missing", () => {
    expect(shouldRejectSubscriptionProductRevocationReplay({
      endNow: true,
      productRevokedAt: new Date("2026-01-01T00:00:00Z"),
      priorProductRevoked: false,
    })).toBe(false);
  });

  it("rejects replay only after both subscription marker and refund revocation row exist", () => {
    expect(shouldRejectSubscriptionProductRevocationReplay({
      endNow: true,
      productRevokedAt: new Date("2026-01-01T00:00:00Z"),
      priorProductRevoked: true,
    })).toBe(true);
  });

  it("does not reject non-immediate refunds", () => {
    expect(shouldRejectSubscriptionProductRevocationReplay({
      endNow: false,
      productRevokedAt: new Date("2026-01-01T00:00:00Z"),
      priorProductRevoked: true,
    })).toBe(false);
  });
});

describe("post-commit refund audit", () => {
  it("propagates a successful audit write", async () => {
    let wrote = false;
    await recordRefundAuditAfterCommit(
      async () => {
        wrote = true;
      },
      () => {
        throw new Error("should not report a successful write");
      },
    );
    expect(wrote).toBe(true);
  });

  it("swallows audit write failures so a dashboard retry cannot double-refund", async () => {
    const reported: unknown[] = [];
    await recordRefundAuditAfterCommit(
      async () => {
        throw new Error("audit insert failed");
      },
      (error) => {
        reported.push(error);
      },
    );
    expect(reported).toHaveLength(1);
    expect((reported[0] as Error).message).toBe("audit insert failed");
  });
});

describe("refund-driven immediate end timestamp", () => {
  it("preserves an existing past endedAt", () => {
    const existingEndedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");

    expect(getRefundDrivenImmediateEndedAt({ existingEndedAt, now })).toBe(existingEndedAt);
  });

  it("pulls a scheduled future endedAt forward to now", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const existingEndedAt = new Date("2026-02-01T00:00:00Z");

    expect(getRefundDrivenImmediateEndedAt({ existingEndedAt, now })).toBe(now);
  });

  it("uses now when no endedAt exists", () => {
    const now = new Date("2026-01-02T00:00:00Z");

    expect(getRefundDrivenImmediateEndedAt({ existingEndedAt: null, now })).toBe(now);
  });
});
