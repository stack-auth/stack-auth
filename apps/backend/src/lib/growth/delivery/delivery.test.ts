import { describe, expect, it } from "vitest";
import { growthDashboardDeliveryChannel } from "./dashboard";
import { GROWTH_DELIVERY_CHANNELS, selectMissingGrowthDeliveryChannelIds } from "./index";

// The engine's wireBriefDeliveries sub-step can't run in a unit test (it needs a database and
// tenancy resolution — the e2e engine suite owns that), so this suite pins the registry invariants
// the wiring relies on instead.

describe("GROWTH_DELIVERY_CHANNELS", () => {
  it("contains exactly the dashboard channel in v1", () => {
    expect([...GROWTH_DELIVERY_CHANNELS.keys()]).toEqual(["dashboard"]);
    expect(GROWTH_DELIVERY_CHANNELS.get("dashboard")).toBe(growthDashboardDeliveryChannel);
  });

  it("keys every channel by its own id", () => {
    // The engine writes the map key into GrowthDelivery.channel and later code may look the channel
    // back up by that column, so a key/id mismatch would silently break re-resolution.
    for (const [key, channel] of GROWTH_DELIVERY_CHANNELS) {
      expect(channel.id).toBe(key);
    }
  });

  it("iterates deterministically", () => {
    expect([...GROWTH_DELIVERY_CHANNELS.keys()]).toEqual([...GROWTH_DELIVERY_CHANNELS.keys()]);
  });
});

describe("selectMissingGrowthDeliveryChannelIds", () => {
  it("returns every registered channel for a brief with no delivery rows", () => {
    expect(selectMissingGrowthDeliveryChannelIds([])).toEqual(["dashboard"]);
  });

  it("returns nothing once all registered channels have rows", () => {
    expect(selectMissingGrowthDeliveryChannelIds(["dashboard"])).toEqual([]);
  });

  it("treats rows of any status as handled and ignores unregistered channels", () => {
    // A "failed" row is terminal (never retried), and a row from a since-removed channel must not
    // confuse the diff — both are represented the same way here: as an existing channel id.
    expect(selectMissingGrowthDeliveryChannelIds(["some-retired-channel"])).toEqual(["dashboard"]);
    expect(selectMissingGrowthDeliveryChannelIds(["dashboard", "some-retired-channel"])).toEqual([]);
  });
});
