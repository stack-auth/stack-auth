"use client";

import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { useRefState } from '@stackframe/stack-shared/dist/utils/react';
import React, { useEffect, useRef } from 'react';
import { WidgetInstance } from './types';

export function ResizeHandle({ widgetInstance, x, y, ...props }: {
  widgetInstance: WidgetInstance<any>,
  x: number,
  y: number,
  onResize: (edges: { top: number, left: number, bottom: number, right: number }) => { top: number, left: number, bottom: number, right: number },
  calculateUnitSize: () => { width: number, height: number },
}) {
  const dragBaseCoordinates = useRefState<[number, number] | null>(null);
  if (![ -1, 0, 1 ].includes(x) || ![ -1, 0, 1 ].includes(y)) {
    throw new StackAssertionError(`Invalid resize handle coordinates, must be -1, 0, or 1: ${x}, ${y}`);
  }

  const isCorner = x !== 0 && y !== 0;

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragBaseCoordinates.current) return;
      const pixelDelta = [event.clientX - dragBaseCoordinates.current[0], event.clientY - dragBaseCoordinates.current[1]];
      const { width: unitWidth, height: unitHeight } = calculateUnitSizeRef.current();
      const unitDelta = [Math.round(pixelDelta[0] / unitWidth), Math.round(pixelDelta[1] / unitHeight)];
      if (unitDelta[0] !== 0 || unitDelta[1] !== 0) {
        const resizeResult = onResizeRef.current({
          top: y === -1 ? unitDelta[1] : 0,
          left: x === -1 ? unitDelta[0] : 0,
          bottom: y === 1 ? unitDelta[1] : 0,
          right: x === 1 ? unitDelta[0] : 0,
        });
        dragBaseCoordinates.set([
          dragBaseCoordinates.current[0] + (resizeResult.left + resizeResult.right) * unitWidth,
          dragBaseCoordinates.current[1] + (resizeResult.top + resizeResult.bottom) * unitHeight,
        ]);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [x, y, props.onResize, props.calculateUnitSize, dragBaseCoordinates]);

  const onResizeRef = useRef(props.onResize);
  onResizeRef.current = props.onResize;

  const calculateUnitSizeRef = useRef(props.calculateUnitSize);
  calculateUnitSizeRef.current = props.calculateUnitSize;

  return (
    <div
      className="border-black dark:border-white"
      style={{
        position: 'absolute',
        zIndex: 100,

        left: x === -1 ? '-3px' : x === 0 ? '50%' : undefined,
        top: y === -1 ? '-3px' : y === 0 ? '50%' : undefined,
        right: x === 1 ? '-3px' : undefined,
        bottom: y === 1 ? '-3px' : undefined,
        transform: `translate(${x === 0 ? '-50%' : 0}, ${y === 0 ? '-50%' : 0})`,

        width: '36px',
        height: '36px',

        opacity: 0.8,

        borderWidth: '6px',
        borderTopStyle: y === -1 ? 'solid' : 'none',
        borderRightStyle: x === 1 ? 'solid' : 'none',
        borderBottomStyle: y === 1 ? 'solid' : 'none',
        borderLeftStyle: x === -1 ? 'solid' : 'none',
        borderTopLeftRadius: x === -1 && y === -1 ? '16px' : undefined,
        borderTopRightRadius: x === 1 && y === -1 ? '16px' : undefined,
        borderBottomLeftRadius: x === -1 && y === 1 ? '16px' : undefined,
        borderBottomRightRadius: x === 1 && y === 1 ? '16px' : undefined,

        cursor: isCorner ? (x === y ? 'nwse-resize' : 'nesw-resize') : (x === 0 ? 'ns-resize' : 'ew-resize'),
      }}
      onMouseDown={(event) => {
        dragBaseCoordinates.set([event.clientX, event.clientY]);
        window.addEventListener('mouseup', () => {
          dragBaseCoordinates.set(null);
        }, { once: true });
        event.preventDefault();
        event.stopPropagation();
        return false;
      }}
    ></div>
  );
}
