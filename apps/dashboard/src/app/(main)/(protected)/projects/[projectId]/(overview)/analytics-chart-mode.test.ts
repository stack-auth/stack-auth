import { describe, expect, it } from "vitest";

import { toggleAnalyticsChartMetricMode } from "./analytics-chart-mode";

describe("toggleAnalyticsChartMetricMode", () => {
  it("clears the active metric when it is selected again", () => {
    expect(toggleAnalyticsChartMetricMode("dau", "dau")).toBe("default");
  });

  it("selects the requested metric when another metric or the overview is active", () => {
    expect(toggleAnalyticsChartMetricMode("default", "visitors")).toBe("visitors");
    expect(toggleAnalyticsChartMetricMode("revenue", "dau")).toBe("dau");
  });
});
