import { describe, expect, it } from "vitest";
import { getSnappedTriggerPlacement, resolveTriggerPosition } from "./dev-tool-trigger-position";

const triggerSize = { width: 76, height: 36 };
const viewport = { width: 1000, height: 700 };

describe("dev tool trigger snapping", () => {
  it("snaps to the nearest vertical side", () => {
    const placement = getSnappedTriggerPlacement({ left: 940, top: 250 }, triggerSize, viewport);

    expect(placement).toEqual({ side: "right", offset: 250 });
    expect(resolveTriggerPosition(placement, triggerSize, viewport)).toEqual({ left: 908, top: 250 });
  });

  it("snaps to the nearest horizontal side", () => {
    const placement = getSnappedTriggerPlacement({ left: 320, top: 10 }, triggerSize, viewport);

    expect(placement).toEqual({ side: "top", offset: 320 });
    expect(resolveTriggerPosition(placement, triggerSize, viewport)).toEqual({ left: 320, top: 16 });
  });

  it("prefers a side over corner docking when the position lands in a corner", () => {
    const placement = getSnappedTriggerPlacement({ left: 924, top: 664 }, triggerSize, viewport);

    expect(placement).toEqual({ side: "right", offset: 664 });
  });

  it("keeps the trigger attached to the same side across viewport changes", () => {
    const placement = { side: "right", offset: 664 } as const;

    expect(resolveTriggerPosition(placement, triggerSize, { width: 800, height: 500 })).toEqual({
      left: 708,
      top: 464,
    });
  });
});
