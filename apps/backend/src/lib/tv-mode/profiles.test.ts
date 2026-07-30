import { describe, expect, it } from "vitest";
import { normalizeTvInterruptionPreferences } from "./profiles";

const legacyPreferences = {
  incidentLevels: {
    critical: "persistent-takeover",
    high: "temporary-takeover",
    medium: "banner",
  },
  incidentTypes: { emailDeliveryDegradation: true },
  celebrations: { userMilestone: true, revenueMilestone: false },
};

describe("TV profile interruption preference normalization", () => {
  it("normalizes legacy preferences into the single final shape", async () => {
    await expect(normalizeTvInterruptionPreferences(legacyPreferences)).resolves.toEqual({
      incidentTypes: { emailDeliveryDegradation: true },
      celebrations: { userMilestone: true, revenueMilestone: false },
      timing: {
        celebration: { takeoverSeconds: 60, animationSeconds: 3600, highlightSeconds: 21600 },
        incident: { takeoverSeconds: 60, resolvedHighlightSeconds: 3600 },
        criticalIncident: { resolvedHighlightSeconds: 21600 },
      },
    });
  });

  it("disables email incidents when every legacy incident treatment was disabled", async () => {
    await expect(normalizeTvInterruptionPreferences({
      ...legacyPreferences,
      incidentLevels: {
        critical: "disabled",
        high: "disabled",
        medium: "disabled",
      },
    })).resolves.toMatchObject({
      incidentTypes: { emailDeliveryDegradation: false },
    });
  });

  it.each([
    ["persistent-takeover", "temporary-takeover", "banner", true],
    ["persistent-takeover", "temporary-takeover", "disabled", true],
    ["persistent-takeover", "banner", "banner", true],
    ["persistent-takeover", "banner", "disabled", true],
    ["persistent-takeover", "disabled", "banner", true],
    ["persistent-takeover", "disabled", "disabled", true],
    ["disabled", "temporary-takeover", "banner", true],
    ["disabled", "temporary-takeover", "disabled", true],
    ["disabled", "banner", "banner", true],
    ["disabled", "banner", "disabled", true],
    ["disabled", "disabled", "banner", true],
    ["disabled", "disabled", "disabled", false],
  ] as const)(
    "normalizes critical=%s high=%s medium=%s to email enabled=%s",
    async (critical, high, medium, expectedEnabled) => {
      await expect(normalizeTvInterruptionPreferences({
        ...legacyPreferences,
        incidentLevels: { critical, high, medium },
      })).resolves.toMatchObject({
        incidentTypes: { emailDeliveryDegradation: expectedEnabled },
        celebrations: legacyPreferences.celebrations,
      });
    },
  );

  it("passes final preferences through without rewriting configured timing", async () => {
    const finalPreferences = {
      incidentTypes: { emailDeliveryDegradation: false },
      celebrations: { userMilestone: false, revenueMilestone: false },
      timing: {
        celebration: { takeoverSeconds: 90, animationSeconds: 1800, highlightSeconds: 43200 },
        incident: { takeoverSeconds: 120, resolvedHighlightSeconds: 21600 },
        criticalIncident: { resolvedHighlightSeconds: 86400 },
      },
    };
    await expect(normalizeTvInterruptionPreferences(finalPreferences)).resolves.toEqual(finalPreferences);
  });
});
