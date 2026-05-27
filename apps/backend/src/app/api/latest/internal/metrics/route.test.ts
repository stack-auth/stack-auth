import { describe, expect, it } from "vitest";
import {
  classifyUserAgent,
  getMetricsWindowBounds,
  isMetricsRevenueInvoiceStatus,
  normalizeAnalyticsOverviewFilters,
} from "./route";

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

  it("normalizes analytics overview filters before adding them to ClickHouse params", () => {
    expect(normalizeAnalyticsOverviewFilters({
      country_code: " us ",
      referrer: " https://example.com ",
      browser: "",
      os: " macOS ",
      device: " Desktop ",
    })).toMatchInlineSnapshot(`
      {
        "browser": undefined,
        "country_code": "US",
        "device": "Desktop",
        "os": "macOS",
        "referrer": "https://example.com",
      }
    `);
  });

  it("classifies user agents for analytics overview breakdowns", () => {
    expect(classifyUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      1440,
    )).toMatchInlineSnapshot(`
      {
        "browser": "Chrome",
        "device": "Desktop",
        "os": "macOS",
      }
    `);

    expect(classifyUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      390,
    )).toMatchInlineSnapshot(`
      {
        "browser": "Safari",
        "device": "Mobile",
        "os": "iOS",
      }
    `);

    expect(classifyUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
      1366,
    )).toMatchInlineSnapshot(`
      {
        "browser": "Edge",
        "device": "Desktop",
        "os": "Windows",
      }
    `);
  });
});
