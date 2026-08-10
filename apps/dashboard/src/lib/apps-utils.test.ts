import { describe, expect, it } from "vitest";
import { getEnabledAppIds, getEnabledNavigableAppIds } from "./apps-utils";

describe("app enablement", () => {
  it("enables Warehouse and Observability independently as top-level apps", () => {
    const installed = {
      analytics: { enabled: true },
      warehouse: { enabled: true },
      observability: { enabled: true },
    };
    expect(getEnabledAppIds({ analytics: { enabled: true } })).not.toContain("observability");
    expect(getEnabledAppIds({ analytics: { enabled: true } })).not.toContain("warehouse");
    expect(getEnabledAppIds(installed)).toContain("observability");
    expect(getEnabledAppIds(installed)).toContain("warehouse");
    expect(getEnabledNavigableAppIds(installed)).toContain("analytics");
    expect(getEnabledNavigableAppIds(installed)).toContain("warehouse");
    expect(getEnabledNavigableAppIds(installed)).toContain("observability");
  });
});
