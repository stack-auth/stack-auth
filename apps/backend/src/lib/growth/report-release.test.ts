import { describe, expect, it } from "vitest";
import { getGrowthReleaseState } from "./report-release";

/**
 * The release state is the one thing the customer's dashboard branches on for the 24-hour hold, and
 * it is derived rather than stored — so the derivation is worth pinning directly. The database side
 * of this module (publish, unpublish, the route gate) is covered end-to-end instead, since it is all
 * Prisma writes with no logic to isolate.
 */
describe("getGrowthReleaseState", () => {
  it("is released once anything has been published, whatever else is happening", () => {
    // Notably true even mid-re-run: a second analysis that is still awaiting review must not take a
    // customer's already-published workspace away from them.
    expect(getGrowthReleaseState({ released: true, interviewSettled: true, analysisFailed: false })).toBe("released");
    expect(getGrowthReleaseState({ released: true, interviewSettled: false, analysisFailed: false })).toBe("released");
    expect(getGrowthReleaseState({ released: true, interviewSettled: true, analysisFailed: true })).toBe("released");
  });

  it("holds once the interview is in and nothing has been published yet", () => {
    expect(getGrowthReleaseState({ released: false, interviewSettled: true, analysisFailed: false })).toBe("preparing");
  });

  it("is not_ready before the interview is settled", () => {
    // The timeline is still showing an earlier step here, so promising a report tomorrow would be
    // premature — the customer has not given us the answers it is written from.
    expect(getGrowthReleaseState({ released: false, interviewSettled: false, analysisFailed: false })).toBe("not_ready");
  });

  it("is not_ready when the run failed, rather than promising a report that is not coming", () => {
    // The analysis step owns the retry affordance in this state; a cheerful "check back tomorrow"
    // next to a failed run would send someone away from the one button that fixes it.
    expect(getGrowthReleaseState({ released: false, interviewSettled: true, analysisFailed: true })).toBe("not_ready");
  });
});
