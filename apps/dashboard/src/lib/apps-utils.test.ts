import { describe, expect, it } from "vitest";
import { getEnabledAppIds, getEnabledNavigableAppIds } from "./apps-utils";

describe("nested app enablement", () => {
  it("inherits Observability enablement without adding a duplicate top-level entry", () => {
    const installed = { analytics: { enabled: true } };
    expect(getEnabledAppIds(installed)).toContain("observability");
    expect(getEnabledNavigableAppIds(installed)).toContain("analytics");
    expect(getEnabledNavigableAppIds(installed)).not.toContain("observability");
  });
});
