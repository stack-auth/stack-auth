import { GrowthPhaseStatus } from "@/generated/prisma/enums";
import { describe, expect, it } from "vitest";
import { growthPhaseStatusToStepState } from "./phase-step-state";

describe("growthPhaseStatusToStepState", () => {
  it("presents dispatched phases as running", () => {
    expect(growthPhaseStatusToStepState(GrowthPhaseStatus.DISPATCHED)).toBe("running");
  });

  it.each([
    [GrowthPhaseStatus.PENDING, "pending"],
    [GrowthPhaseStatus.RUNNING, "running"],
    [GrowthPhaseStatus.COMPLETED, "done"],
    [GrowthPhaseStatus.SKIPPED, "done"],
    [GrowthPhaseStatus.FAILED, "failed"],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(growthPhaseStatusToStepState(status)).toBe(expected);
  });
});
