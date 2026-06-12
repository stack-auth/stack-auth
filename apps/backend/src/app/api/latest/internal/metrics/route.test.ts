import { describe, expect, it } from "vitest";
import {
  buildAnalyticsOverviewUserAgentFilterFragmentsForTest,
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
      since: " 2026-06-01T00:00:00.000Z ",
      until: "",
    })).toMatchInlineSnapshot(`
      {
        "browser": undefined,
        "country_code": "US",
        "device": "Desktop",
        "os": "macOS",
        "referrer": "https://example.com",
        "since": "2026-06-01T00:00:00.000Z",
        "until": undefined,
      }
    `);
  });

  it("builds deterministic user-agent filter fragments without a raw user-agent allowlist", () => {
    expect(buildAnalyticsOverviewUserAgentFilterFragmentsForTest({
      browser: "Chrome",
      os: "macOS",
      device: "Desktop",
    })).toMatchInlineSnapshot(`
      {
        "hasBrowserFilter": true,
        "hasDeviceFilter": true,
        "hasOsFilter": true,
        "params": {
          "browserFilter": "Chrome",
          "deviceFilter": "Desktop",
          "osFilter": "macOS",
        },
        "usesRawUserAgentAllowlist": false,
      }
    `);
  });
});
