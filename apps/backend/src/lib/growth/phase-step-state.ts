import { GrowthPhaseStatus } from "@/generated/prisma/enums";

export type GrowthPhaseStepState = "pending" | "running" | "done" | "failed";

/** Maps the persisted orchestration state to the coarser customer-facing checklist state. */
export function growthPhaseStatusToStepState(status: GrowthPhaseStatus): GrowthPhaseStepState {
  switch (status) {
    case GrowthPhaseStatus.PENDING: {
      return "pending";
    }
    case GrowthPhaseStatus.DISPATCHED:
    case GrowthPhaseStatus.RUNNING: {
      // DISPATCHED means the phase was claimed and successfully handed to the agent runtime. Treat
      // it as active in the UI so short phases do not jump from an idle circle straight to done
      // between dashboard polls without ever showing loading feedback.
      return "running";
    }
    case GrowthPhaseStatus.COMPLETED:
    case GrowthPhaseStatus.SKIPPED: {
      return "done";
    }
    case GrowthPhaseStatus.FAILED: {
      return "failed";
    }
  }
}
