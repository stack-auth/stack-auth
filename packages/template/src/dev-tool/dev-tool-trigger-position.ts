export type TriggerCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type TriggerPlacement = {
  corner: TriggerCorner;
};

export type TriggerPosition = {
  left: number;
  top: number;
};

export type TriggerSize = {
  width: number;
  height: number;
};

export type TriggerViewport = {
  width: number;
  height: number;
};

export const TRIGGER_EDGE_MARGIN = 16;

/**
 * Clamps a position so the trigger stays fully within the viewport.
 * Used during drag to prevent the pill from leaving the screen.
 */
export function clampTriggerPosition(
  position: TriggerPosition,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPosition {
  return {
    left: Math.max(0, Math.min(position.left, viewport.width - triggerSize.width)),
    top: Math.max(0, Math.min(position.top, viewport.height - triggerSize.height)),
  };
}

/**
 * Returns the exact pixel position for a corner placement.
 * The trigger is always `TRIGGER_EDGE_MARGIN` px from both adjacent edges.
 */
export function resolveTriggerPosition(
  placement: TriggerPlacement,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPosition {
  const m = TRIGGER_EDGE_MARGIN;
  switch (placement.corner) {
    case 'top-left': {
      return { left: m, top: m };
    }
    case 'top-right': {
      return { left: viewport.width - triggerSize.width - m, top: m };
    }
    case 'bottom-left': {
      return { left: m, top: viewport.height - triggerSize.height - m };
    }
    case 'bottom-right': {
      return { left: viewport.width - triggerSize.width - m, top: viewport.height - triggerSize.height - m };
    }
  }
}

/**
 * Snaps a free position to the nearest corner by checking which viewport
 * quadrant the trigger center falls in.
 */
export function getSnappedTriggerPlacement(
  position: TriggerPosition,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPlacement {
  const cx = position.left + triggerSize.width / 2;
  const cy = position.top + triggerSize.height / 2;

  const corner: TriggerCorner =
    cy < viewport.height / 2
      ? cx < viewport.width / 2 ? 'top-left' : 'top-right'
      : cx < viewport.width / 2 ? 'bottom-left' : 'bottom-right';

  return { corner };
}
