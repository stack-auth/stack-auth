import { describe, expect, it } from "vitest";
import {
  computeFirstResponseDueAt,
  computeNextResponseDueAt,
  computeSlaUrgency,
  DEFAULT_SUPPORT_SLA,
  resolveSupportSla,
  SLA_URGENT_THRESHOLD_MS,
  SLA_WARNING_THRESHOLD_MS,
  type SupportSlaConfig,
} from "./support-sla";

const enabledSla: SupportSlaConfig = {
  enabled: true,
  firstResponseMinutes: 60,
  nextResponseMinutes: 120,
};

describe("resolveSupportSla", () => {
  it("returns DEFAULT_SUPPORT_SLA when the input is nullish", () => {
    expect(resolveSupportSla(null)).toEqual(DEFAULT_SUPPORT_SLA);
    expect(resolveSupportSla(undefined)).toEqual(DEFAULT_SUPPORT_SLA);
    expect(resolveSupportSla({} as any)).toEqual(DEFAULT_SUPPORT_SLA);
  });

  it("fills in missing fields with safe defaults", () => {
    const resolved = resolveSupportSla({
      sla: { enabled: true, firstResponseMinutes: 30 },
    } as any);
    expect(resolved).toEqual({
      enabled: true,
      firstResponseMinutes: 30,
      nextResponseMinutes: null,
    });
  });
});

describe("computeFirstResponseDueAt", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");

  it("returns null when SLA is disabled", () => {
    expect(computeFirstResponseDueAt(now, { ...enabledSla, enabled: false })).toBeNull();
  });

  it("returns null when no target is set", () => {
    expect(computeFirstResponseDueAt(now, { ...enabledSla, firstResponseMinutes: null })).toBeNull();
  });

  it("adds the configured minutes to now", () => {
    const due = computeFirstResponseDueAt(now, enabledSla);
    expect(due).not.toBeNull();
    expect(due!.toISOString()).toBe("2026-04-22T13:00:00.000Z");
  });

  it("returns null when the configured value is non-positive", () => {
    expect(computeFirstResponseDueAt(now, { ...enabledSla, firstResponseMinutes: 0 })).toBeNull();
  });
});

describe("computeNextResponseDueAt", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");

  it("returns null when SLA is disabled", () => {
    expect(computeNextResponseDueAt(now, { ...enabledSla, enabled: false })).toBeNull();
  });

  it("returns null when no target is set", () => {
    expect(computeNextResponseDueAt(now, { ...enabledSla, nextResponseMinutes: null })).toBeNull();
  });

  it("adds the configured next-response minutes to now", () => {
    const due = computeNextResponseDueAt(now, enabledSla);
    expect(due!.toISOString()).toBe("2026-04-22T14:00:00.000Z");
  });
});

describe("computeSlaUrgency", () => {
  const now = new Date("2026-04-22T12:00:00.000Z");

  it("returns 'overdue' when the due timestamp is in the past", () => {
    expect(computeSlaUrgency(new Date(now.getTime() - 1), now)).toBe("overdue");
    expect(computeSlaUrgency(new Date(now.getTime() - 60_000), now)).toBe("overdue");
  });

  it("returns 'overdue' when the due timestamp is exactly now", () => {
    expect(computeSlaUrgency(now, now)).toBe("overdue");
  });

  it("returns 'urgent' within the urgent threshold", () => {
    expect(computeSlaUrgency(new Date(now.getTime() + 60_000), now)).toBe("urgent");
    expect(computeSlaUrgency(new Date(now.getTime() + SLA_URGENT_THRESHOLD_MS), now)).toBe("urgent");
  });

  it("returns 'warning' within the warning threshold", () => {
    expect(computeSlaUrgency(new Date(now.getTime() + SLA_URGENT_THRESHOLD_MS + 60_000), now)).toBe("warning");
    expect(computeSlaUrgency(new Date(now.getTime() + SLA_WARNING_THRESHOLD_MS), now)).toBe("warning");
  });

  it("returns 'ok' when comfortably before the warning threshold", () => {
    expect(computeSlaUrgency(new Date(now.getTime() + SLA_WARNING_THRESHOLD_MS + 60_000), now)).toBe("ok");
    expect(computeSlaUrgency(new Date(now.getTime() + 24 * 60 * 60 * 1000), now)).toBe("ok");
  });

  describe("with a windowStartedAt", () => {
    it("scales thresholds down for short SLA windows so t=0 is not immediately urgent", () => {
      // 5-minute SLA window: due 5 min after it started.
      const windowStartedAt = now;
      const dueAt = new Date(now.getTime() + 5 * 60_000);
      // Right at the start, 5 min remaining — should be 'ok' (>50% of window remaining).
      expect(computeSlaUrgency(dueAt, now, { windowStartedAt })).toBe("ok");
      // At t+2min (3 min remaining, 60% of window remaining) — still 'ok'.
      const twoMinLater = new Date(now.getTime() + 2 * 60_000);
      expect(computeSlaUrgency(dueAt, twoMinLater, { windowStartedAt })).toBe("ok");
      // At t+3min (2 min remaining, 40% of window) — 'warning'.
      const threeMinLater = new Date(now.getTime() + 3 * 60_000);
      expect(computeSlaUrgency(dueAt, threeMinLater, { windowStartedAt })).toBe("warning");
      // At t+4min (1 min remaining, 20% of window) — 'urgent'.
      const fourMinLater = new Date(now.getTime() + 4 * 60_000);
      expect(computeSlaUrgency(dueAt, fourMinLater, { windowStartedAt })).toBe("urgent");
    });

    it("caps thresholds at the fixed wall-clock windows for long SLAs", () => {
      // 24-hour SLA window.
      const windowStartedAt = now;
      const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      // 2 hours remaining (long past the 50% mark of the 24h window) — should
      // still be 'ok' because the warning cap is 60 min.
      const tMinusTwoHours = new Date(dueAt.getTime() - 2 * 60 * 60 * 1000);
      expect(computeSlaUrgency(dueAt, tMinusTwoHours, { windowStartedAt })).toBe("ok");
      // 45 minutes remaining — 'warning' (inside the 60-min cap).
      const tMinus45Min = new Date(dueAt.getTime() - 45 * 60_000);
      expect(computeSlaUrgency(dueAt, tMinus45Min, { windowStartedAt })).toBe("warning");
      // 10 minutes remaining — 'urgent' (inside the 15-min cap).
      const tMinus10Min = new Date(dueAt.getTime() - 10 * 60_000);
      expect(computeSlaUrgency(dueAt, tMinus10Min, { windowStartedAt })).toBe("urgent");
    });

    it("falls back to fixed thresholds when windowStartedAt is nullish", () => {
      const dueAt = new Date(now.getTime() + 30 * 60_000);
      expect(computeSlaUrgency(dueAt, now)).toBe("warning");
      expect(computeSlaUrgency(dueAt, now, { windowStartedAt: null })).toBe("warning");
      expect(computeSlaUrgency(dueAt, now, { windowStartedAt: undefined })).toBe("warning");
    });
  });
});
