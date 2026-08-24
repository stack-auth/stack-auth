import { describe, expect, it } from "vitest";
import { getGrowthAdminEditGate } from "./growth-admin-lifecycle";
import { buildGrowthDemoStatus, GROWTH_DEMO_NOW_MILLIS } from "./growth-demo-data";
import { GROWTH_PHASES, getGrowthPhase } from "./growth-status";
import type { GrowthStatus } from "./growth-types";

function baseStatus(): GrowthStatus {
  return buildGrowthDemoStatus("steady-state", GROWTH_DEMO_NOW_MILLIS);
}

describe("getGrowthAdminEditGate", () => {
  it("blocks editing before onboarding", () => {
    const status = baseStatus();
    status.onboarding = { completed: false, completedAtMillis: null, websiteUrl: null };
    const gate = getGrowthAdminEditGate(status);
    expect(gate.phase).toBe("not-onboarded");
    expect(gate.contentEditable).toBe(false);
    expect(gate.blockedReason).not.toBe(null);
  });

  it("blocks editing while deep research runs", () => {
    const status = baseStatus();
    status.analysis = { ...status.analysis, state: "running", completedAtMillis: null };
    expect(getGrowthAdminEditGate(status).contentEditable).toBe(false);
  });

  it("blocks editing when deep research failed", () => {
    const status = baseStatus();
    status.analysis = { ...status.analysis, state: "failed", errorMessage: "Something went wrong." };
    expect(getGrowthAdminEditGate(status).contentEditable).toBe(false);
  });

  it("blocks editing while the customer still owes interview answers", () => {
    const status = baseStatus();
    status.interview = { state: "in_progress", answeredCount: 3, estimatedTotal: 8 };
    const gate = getGrowthAdminEditGate(status);
    expect(gate.phase).toBe("interview");
    expect(gate.contentEditable).toBe(false);
  });

  it("allows editing once the report exists, and in steady state", () => {
    const reportReady = baseStatus();
    reportReady.latestBrief = null;
    expect(getGrowthPhase(reportReady)).toBe("report-ready");
    expect(getGrowthAdminEditGate(reportReady)).toEqual({ phase: "report-ready", contentEditable: true, blockedReason: null });
    expect(getGrowthAdminEditGate(baseStatus())).toEqual({ phase: "steady-state", contentEditable: true, blockedReason: null });
  });

  it("gives every blocked phase a reason, and every editable phase none", () => {
    const gates = GROWTH_PHASES.map((phase) => {
      const status = baseStatus();
      switch (phase) {
        case "not-onboarded": {
          status.onboarding = { completed: false, completedAtMillis: null, websiteUrl: null };
          break;
        }
        case "analyzing": {
          status.analysis = { ...status.analysis, state: "running", completedAtMillis: null };
          break;
        }
        case "analysis-failed": {
          status.analysis = { ...status.analysis, state: "failed", errorMessage: "Something went wrong." };
          break;
        }
        case "interview": {
          status.interview = { state: "ready", answeredCount: 0, estimatedTotal: 8 };
          break;
        }
        case "report-ready": {
          status.latestBrief = null;
          break;
        }
        case "steady-state": {
          break;
        }
      }
      expect(getGrowthPhase(status)).toBe(phase);
      return getGrowthAdminEditGate(status);
    });
    for (const gate of gates) {
      expect(gate.contentEditable).toBe(gate.blockedReason == null);
    }
  });
});
