import { GrowthRunStatus } from "@/generated/prisma/enums";
import { describe, expect, test } from "vitest";
import {
  GROWTH_WATCHDOG_EVENT_BUCKET_MS,
  GROWTH_WATCHDOG_RUN_GRACE_MS,
  getGrowthWatchdogResurrectionEventId,
  isPastGrowthBriefCatchupHour,
  selectGrowthWatchdogLeg,
  yesterdayUtcDateString,
} from "./watchdog";
import { getGrowthAnalysisLegRunKeys } from "./workflows";

const now = new Date("2026-08-04T12:00:00.000Z");
const beforeGrace = new Date(now.getTime() - GROWTH_WATCHDOG_RUN_GRACE_MS - 1000);
const withinGrace = new Date(now.getTime() - GROWTH_WATCHDOG_RUN_GRACE_MS + 1000);

describe("yesterdayUtcDateString", () => {
  test("returns the last fully-elapsed UTC day", () => {
    expect(yesterdayUtcDateString(new Date("2026-08-04T12:00:00.000Z"))).toBe("2026-08-03");
    expect(yesterdayUtcDateString(new Date("2026-08-04T00:00:00.000Z"))).toBe("2026-08-03");
    expect(yesterdayUtcDateString(new Date("2026-08-04T23:59:59.999Z"))).toBe("2026-08-03");
  });

  test("handles month and year boundaries", () => {
    expect(yesterdayUtcDateString(new Date("2026-03-01T05:00:00.000Z"))).toBe("2026-02-28");
    expect(yesterdayUtcDateString(new Date("2026-01-01T05:00:00.000Z"))).toBe("2025-12-31");
  });
});

describe("selectGrowthWatchdogLeg", () => {
  test("PENDING/RUNNING runs past grace need the activation leg", () => {
    for (const status of [GrowthRunStatus.PENDING, GrowthRunStatus.RUNNING]) {
      expect(selectGrowthWatchdogLeg({ status, createdAt: beforeGrace, interviewStatus: null, interviewCompletedAt: null, awaitingIntegrations: false }, now)).toBe("activation");
      expect(selectGrowthWatchdogLeg({ status, createdAt: withinGrace, interviewStatus: null, interviewCompletedAt: null, awaitingIntegrations: false }, now)).toBe(null);
    }
  });

  // Integrations is currently auto-skipped by the orchestration tick. A run left pending by an older
  // version must therefore be revived so the next tick can apply that policy.
  test("revives older runs awaiting integrations so the tick can auto-skip it", () => {
    for (const status of [GrowthRunStatus.PENDING, GrowthRunStatus.RUNNING]) {
      expect(selectGrowthWatchdogLeg({ status, createdAt: beforeGrace, interviewStatus: null, interviewCompletedAt: null, awaitingIntegrations: true }, now)).toBe("activation");
      expect(selectGrowthWatchdogLeg({ status, createdAt: withinGrace, interviewStatus: null, interviewCompletedAt: null, awaitingIntegrations: true }, now)).toBe(null);
    }
  });

  // The lost-event safety net for the integrations resume: once the phase is settled the run is no
  // longer "awaiting", so a leg-less run past grace is resurrected like any other.
  test("a RUNNING run whose integrations phase settled still gets resurrected", () => {
    expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.RUNNING, createdAt: beforeGrace, interviewStatus: null, interviewCompletedAt: null, awaitingIntegrations: false }, now)).toBe("activation");
  });

  test("AWAITING_INTERVIEW with an open interview is legitimately at rest", () => {
    for (const interviewStatus of [null, "pending", "active"]) {
      expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.AWAITING_INTERVIEW, createdAt: beforeGrace, interviewStatus, interviewCompletedAt: null, awaitingIntegrations: false }, now)).toBe(null);
    }
  });

  test("AWAITING_INTERVIEW with a finished interview past grace needs the interview leg", () => {
    for (const interviewStatus of ["completed", "skipped"]) {
      expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.AWAITING_INTERVIEW, createdAt: beforeGrace, interviewStatus, interviewCompletedAt: beforeGrace, awaitingIntegrations: false }, now)).toBe("interview");
      expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.AWAITING_INTERVIEW, createdAt: beforeGrace, interviewStatus, interviewCompletedAt: withinGrace, awaitingIntegrations: false }, now)).toBe(null);
    }
  });

  test("COMPOSING_REPORT past grace needs the interview leg", () => {
    expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.COMPOSING_REPORT, createdAt: beforeGrace, interviewStatus: "completed", interviewCompletedAt: beforeGrace, awaitingIntegrations: false }, now)).toBe("interview");
    expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.COMPOSING_REPORT, createdAt: beforeGrace, interviewStatus: "completed", interviewCompletedAt: withinGrace, awaitingIntegrations: false }, now)).toBe(null);
    // Defensive fallback: a (theoretically impossible) missing completedAt
    // falls back to run age instead of never resurrecting.
    expect(selectGrowthWatchdogLeg({ status: GrowthRunStatus.COMPOSING_REPORT, createdAt: beforeGrace, interviewStatus: "completed", interviewCompletedAt: null, awaitingIntegrations: false }, now)).toBe("interview");
  });

  test("terminal runs never need a leg", () => {
    for (const status of [GrowthRunStatus.COMPLETED, GrowthRunStatus.FAILED, GrowthRunStatus.CANCELLED]) {
      expect(selectGrowthWatchdogLeg({ status, createdAt: beforeGrace, interviewStatus: "completed", interviewCompletedAt: beforeGrace, awaitingIntegrations: false }, now)).toBe(null);
    }
  });
});

describe("getGrowthAnalysisLegRunKeys", () => {
  test("matches the runKey shape embedded in the workflow source", () => {
    expect(getGrowthAnalysisLegRunKeys("run-1")).toEqual([
      "run-1:custom.growth.analysis-run-activated",
      "run-1:custom.growth.interview-finished",
    ]);
  });
});

describe("getGrowthWatchdogResurrectionEventId", () => {
  test("is a valid UUID and stable within a 10-minute bucket", () => {
    const a = getGrowthWatchdogResurrectionEventId("t1", "r1", "activation", now);
    const b = getGrowthWatchdogResurrectionEventId("t1", "r1", "activation", new Date(now.getTime() + 1));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b).toBe(a);
  });

  test("differs across buckets, legs, runs, and tenancies", () => {
    const base = getGrowthWatchdogResurrectionEventId("t1", "r1", "activation", now);
    expect(getGrowthWatchdogResurrectionEventId("t1", "r1", "activation", new Date(now.getTime() + GROWTH_WATCHDOG_EVENT_BUCKET_MS))).not.toBe(base);
    expect(getGrowthWatchdogResurrectionEventId("t1", "r1", "interview", now)).not.toBe(base);
    expect(getGrowthWatchdogResurrectionEventId("t1", "r2", "activation", now)).not.toBe(base);
    expect(getGrowthWatchdogResurrectionEventId("t2", "r1", "activation", now)).not.toBe(base);
  });
});

describe("isPastGrowthBriefCatchupHour", () => {
  test("only fires after 02:00 UTC", () => {
    expect(isPastGrowthBriefCatchupHour(new Date("2026-08-04T00:10:00.000Z"))).toBe(false);
    expect(isPastGrowthBriefCatchupHour(new Date("2026-08-04T01:59:59.000Z"))).toBe(false);
    expect(isPastGrowthBriefCatchupHour(new Date("2026-08-04T02:00:00.000Z"))).toBe(true);
    expect(isPastGrowthBriefCatchupHour(new Date("2026-08-04T23:00:00.000Z"))).toBe(true);
  });
});
