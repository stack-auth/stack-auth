import { describe, expect, it } from "vitest";
import { getMetricsWindowBounds, isMetricsRevenueInvoiceStatus } from "./route";

describe("internal metrics helpers", () => {
  it("only counts paid and succeeded invoices as revenue", () => {
    expect(isMetricsRevenueInvoiceStatus("paid")).toBe(true);
    expect(isMetricsRevenueInvoiceStatus("succeeded")).toBe(true);
    expect(isMetricsRevenueInvoiceStatus("failed")).toBe(false);
    expect(isMetricsRevenueInvoiceStatus("uncollectible")).toBe(false);
    expect(isMetricsRevenueInvoiceStatus(null)).toBe(false);
  });

  it("derives a single UTC-aligned rolling window from one clock", () => {
    const { todayUtc, since, untilExclusive } = getMetricsWindowBounds(new Date("2026-04-13T23:59:59.999Z"));

    expect(todayUtc.toISOString()).toBe("2026-04-13T00:00:00.000Z");
    expect(since.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(untilExclusive.toISOString()).toBe("2026-04-14T00:00:00.000Z");
  });
});
