import { describe, expect, it } from "vitest";
import { getBrainQueueClaimOwnershipWhere } from "./queue";

describe("getBrainQueueClaimOwnershipWhere", () => {
  it("requires every item id, receipt, live claim, and tenancy to match", () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    expect(getBrainQueueClaimOwnershipWhere({
      tenancyId: "00000000-0000-4000-8000-000000000001",
      claims: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          claimLeaseToken: "00000000-0000-4000-8000-000000000021",
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          claimLeaseToken: "00000000-0000-4000-8000-000000000022",
        },
      ],
      now,
    })).toEqual({
      tenancyId: "00000000-0000-4000-8000-000000000001",
      status: "CLAIMED",
      claimLeaseUntil: { gt: now },
      OR: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          claimLeaseToken: "00000000-0000-4000-8000-000000000021",
        },
        {
          id: "00000000-0000-4000-8000-000000000012",
          claimLeaseToken: "00000000-0000-4000-8000-000000000022",
        },
      ],
    });
  });
});
