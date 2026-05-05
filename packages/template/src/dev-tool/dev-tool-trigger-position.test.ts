import { describe, expect, it } from "vitest";
import { clampTriggerPosition, getSnappedTriggerPlacement, resolveTriggerPosition } from "./dev-tool-trigger-position";

const triggerSize = { width: 36, height: 36 };
const viewport = { width: 1000, height: 700 };

describe("corner snapping", () => {
  it("snaps to bottom-right when trigger is in the bottom-right quadrant", () => {
    const placement = getSnappedTriggerPlacement({ left: 800, top: 600 }, triggerSize, viewport);
    expect(placement).toEqual({ corner: "bottom-right" });
  });

  it("snaps to top-left when trigger is in the top-left quadrant", () => {
    const placement = getSnappedTriggerPlacement({ left: 10, top: 20 }, triggerSize, viewport);
    expect(placement).toEqual({ corner: "top-left" });
  });

  it("snaps to top-right when trigger is in the top-right quadrant", () => {
    const placement = getSnappedTriggerPlacement({ left: 900, top: 50 }, triggerSize, viewport);
    expect(placement).toEqual({ corner: "top-right" });
  });

  it("snaps to bottom-left when trigger is in the bottom-left quadrant", () => {
    const placement = getSnappedTriggerPlacement({ left: 50, top: 650 }, triggerSize, viewport);
    expect(placement).toEqual({ corner: "bottom-left" });
  });
});

describe("corner position resolution", () => {
  it("resolves bottom-right to margin from bottom and right edges", () => {
    const pos = resolveTriggerPosition({ corner: "bottom-right" }, triggerSize, viewport);
    expect(pos).toEqual({ left: 1000 - 36 - 16, top: 700 - 36 - 16 });
  });

  it("resolves top-left to margin from top and left edges", () => {
    const pos = resolveTriggerPosition({ corner: "top-left" }, triggerSize, viewport);
    expect(pos).toEqual({ left: 16, top: 16 });
  });

  it("resolves top-right to margin from top and right edges", () => {
    const pos = resolveTriggerPosition({ corner: "top-right" }, triggerSize, viewport);
    expect(pos).toEqual({ left: 1000 - 36 - 16, top: 16 });
  });

  it("resolves bottom-left to margin from bottom and left edges", () => {
    const pos = resolveTriggerPosition({ corner: "bottom-left" }, triggerSize, viewport);
    expect(pos).toEqual({ left: 16, top: 700 - 36 - 16 });
  });

  it("has equal left/top margin for top-left corner", () => {
    const pos = resolveTriggerPosition({ corner: "top-left" }, triggerSize, viewport);
    expect(pos.left).toBe(pos.top);
  });

  it("keeps the trigger on-screen when the viewport is smaller than the margin and trigger", () => {
    const tinyViewport = { width: 40, height: 40 };
    const pos = resolveTriggerPosition({ corner: "bottom-right" }, triggerSize, tinyViewport);
    expect(pos).toEqual({ left: 4, top: 4 });
  });
});

describe("resize anchor regression", () => {
  it("bottom-right corner tracks the bottom-right edge after viewport shrinks", () => {
    const placement = { corner: "bottom-right" } as const;
    const pos1 = resolveTriggerPosition(placement, triggerSize, { width: 800, height: 600 });
    expect(pos1).toEqual({ left: 800 - 36 - 16, top: 600 - 36 - 16 });
  });

  it("bottom-right corner tracks the bottom-right edge after viewport grows", () => {
    const placement = { corner: "bottom-right" } as const;
    const pos2 = resolveTriggerPosition(placement, triggerSize, { width: 1440, height: 900 });
    expect(pos2).toEqual({ left: 1440 - 36 - 16, top: 900 - 36 - 16 });
  });

  it("top-right corner tracks the top-right edge across resize cycles", () => {
    const placement = { corner: "top-right" } as const;
    for (const vw of [600, 800, 1000, 1440]) {
      const pos = resolveTriggerPosition(placement, triggerSize, { width: vw, height: 700 });
      expect(pos.left).toBe(vw - 36 - 16);
      expect(pos.top).toBe(16);
    }
  });

  it("corner does not change on resize (placement is stable)", () => {
    // The same corner placement always resolves without changing its corner.
    const placement = getSnappedTriggerPlacement({ left: 950, top: 650 }, triggerSize, viewport);
    expect(placement.corner).toBe("bottom-right");

    // After resize, applying resolveTriggerPosition still produces bottom-right geometry.
    const smallVp = resolveTriggerPosition(placement, triggerSize, { width: 400, height: 300 });
    expect(smallVp.left).toBe(400 - 36 - 16);
    expect(smallVp.top).toBe(300 - 36 - 16);
  });
});

describe("clampTriggerPosition", () => {
  it("clamps positions outside the viewport", () => {
    expect(clampTriggerPosition({ left: -50, top: -20 }, triggerSize, viewport)).toEqual({ left: 0, top: 0 });
    expect(clampTriggerPosition({ left: 9999, top: 9999 }, triggerSize, viewport)).toEqual({
      left: viewport.width - triggerSize.width,
      top: viewport.height - triggerSize.height,
    });
  });

  it("preserves positions already within bounds", () => {
    const pos = { left: 200, top: 300 };
    expect(clampTriggerPosition(pos, triggerSize, viewport)).toEqual(pos);
  });
});
