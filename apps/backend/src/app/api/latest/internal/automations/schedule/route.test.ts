import { describe, expect, it } from "vitest";
import { scheduledAutomationWorkBudgetMs } from "@/lib/automations/scheduler";
import { maxDuration, parseAutomationScheduleBound } from "./route";

describe("automation schedule route bounds", () => {
  it("keeps the work budget below the route runtime limit", () => {
    expect(maxDuration).toBe(60);
    expect(parseAutomationScheduleBound("45000", "max_duration_ms", 45_000)).toBe(45_000);
    expect(scheduledAutomationWorkBudgetMs).toBeLessThan(maxDuration * 1000);
  });

  it("allows omitted and lower positive integer bounds", () => {
    expect(parseAutomationScheduleBound(undefined, "limit", 100)).toBeUndefined();
    expect(parseAutomationScheduleBound("25", "limit", 100)).toBe(25);
  });

  it.each(["0", "101", "1.5", "01", "not-a-number"])("rejects an invalid internal bound: %s", (value) => {
    expect(() => parseAutomationScheduleBound(value, "limit", 100))
      .toThrowError("limit must be an integer between 1 and 100");
  });
});
