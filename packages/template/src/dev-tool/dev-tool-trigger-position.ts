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

function getSnapBounds(
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
) {
  const maxLeft = Math.max(0, viewport.width - triggerSize.width);
  const maxTop = Math.max(0, viewport.height - triggerSize.height);
  const minLeft = Math.min(TRIGGER_EDGE_MARGIN, maxLeft);
  const minTop = Math.min(TRIGGER_EDGE_MARGIN, maxTop);
  return {
    minLeft,
    maxLeft: Math.max(minLeft, maxLeft - TRIGGER_EDGE_MARGIN),
    minTop,
    maxTop: Math.max(minTop, maxTop - TRIGGER_EDGE_MARGIN),
  };
}

/**
 * Clamps a position so the trigger stays fully within the viewport.
 * Used during drag to prevent the pill from leaving the screen.
 */
export function clampTriggerPosition(
  position: TriggerPosition,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPosition {
  const maxLeft = Math.max(0, viewport.width - triggerSize.width);
  const maxTop = Math.max(0, viewport.height - triggerSize.height);
  return {
    left: Math.max(0, Math.min(position.left, maxLeft)),
    top: Math.max(0, Math.min(position.top, maxTop)),
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
  const bounds = getSnapBounds(triggerSize, viewport);
  const position = (() => {
    switch (placement.corner) {
      case 'top-left': {
        return { left: bounds.minLeft, top: bounds.minTop };
      }
      case 'top-right': {
        return { left: bounds.maxLeft, top: bounds.minTop };
      }
      case 'bottom-left': {
        return { left: bounds.minLeft, top: bounds.maxTop };
      }
      case 'bottom-right': {
        return { left: bounds.maxLeft, top: bounds.maxTop };
      }
    }
  })();

  return clampTriggerPosition(position, triggerSize, viewport);
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
