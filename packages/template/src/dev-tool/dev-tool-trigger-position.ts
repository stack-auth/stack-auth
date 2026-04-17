export type TriggerSide = 'left' | 'right' | 'top' | 'bottom';

export type TriggerPosition = {
  left: number;
  top: number;
};

export type TriggerPlacement = {
  side: TriggerSide;
  offset: number;
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getBounds(
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
  edgeMargin: number,
) {
  const maxLeft = Math.max(0, viewport.width - triggerSize.width);
  const maxTop = Math.max(0, viewport.height - triggerSize.height);
  const minSnapLeft = Math.min(edgeMargin, maxLeft);
  const maxSnapLeft = Math.max(minSnapLeft, maxLeft - edgeMargin);
  const minSnapTop = Math.min(edgeMargin, maxTop);
  const maxSnapTop = Math.max(minSnapTop, maxTop - edgeMargin);

  return {
    maxLeft,
    maxTop,
    minSnapLeft,
    maxSnapLeft,
    minSnapTop,
    maxSnapTop,
  };
}

export function clampTriggerPosition(
  position: TriggerPosition,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPosition {
  const { maxLeft, maxTop } = getBounds(triggerSize, viewport, TRIGGER_EDGE_MARGIN);

  return {
    left: clamp(position.left, 0, maxLeft),
    top: clamp(position.top, 0, maxTop),
  };
}

export function getSnappedTriggerPlacement(
  position: TriggerPosition,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPlacement {
  const clamped = clampTriggerPosition(position, triggerSize, viewport);
  const bounds = getBounds(triggerSize, viewport, TRIGGER_EDGE_MARGIN);

  const candidates: TriggerPlacement[] = [
    { side: 'left', offset: clamped.top },
    { side: 'right', offset: clamped.top },
    { side: 'top', offset: clamped.left },
    { side: 'bottom', offset: clamped.left },
  ];

  function getDistance(placement: TriggerPlacement) {
    switch (placement.side) {
      case 'left': {
        return Math.abs(clamped.left - bounds.minSnapLeft);
      }
      case 'right': {
        return Math.abs(clamped.left - bounds.maxSnapLeft);
      }
      case 'top': {
        return Math.abs(clamped.top - bounds.minSnapTop);
      }
      case 'bottom': {
        return Math.abs(clamped.top - bounds.maxSnapTop);
      }
    }
  }

  let nearest = candidates[0];
  let nearestDistance = getDistance(nearest);
  for (const candidate of candidates.slice(1)) {
    const distance = getDistance(candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function resolveTriggerPosition(
  placement: TriggerPlacement,
  triggerSize: TriggerSize,
  viewport: TriggerViewport,
): TriggerPosition {
  const bounds = getBounds(triggerSize, viewport, TRIGGER_EDGE_MARGIN);

  switch (placement.side) {
    case 'left': {
      return {
        left: bounds.minSnapLeft,
        top: clamp(placement.offset, 0, bounds.maxTop),
      };
    }
    case 'right': {
      return {
        left: bounds.maxSnapLeft,
        top: clamp(placement.offset, 0, bounds.maxTop),
      };
    }
    case 'top': {
      return {
        left: clamp(placement.offset, 0, bounds.maxLeft),
        top: bounds.minSnapTop,
      };
    }
    case 'bottom': {
      return {
        left: clamp(placement.offset, 0, bounds.maxLeft),
        top: bounds.maxSnapTop,
      };
    }
  }
}
