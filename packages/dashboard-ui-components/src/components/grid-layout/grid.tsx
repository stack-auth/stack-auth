"use client";

import { DndContext, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import useResizeObserver from '@react-hook/resize-observer';
import { range } from '@stackframe/stack-shared/dist/utils/arrays';
import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { deepPlainEquals } from '@stackframe/stack-shared/dist/utils/objects';
import { RefState, mapRefState } from '@stackframe/stack-shared/dist/utils/react';
import { TooltipProvider } from '@stackframe/stack-ui';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { DesignButton } from '../button';
import type { DesignButtonProps } from '../button';
import { WidgetInstance, Widget, getSettings, getState, gridGapPixels, gridUnitHeight, mobileModeCutoffWidth } from './types';
import { WidgetInstanceGrid } from './grid-logic';
import { Draggable } from './draggable';

export const SwappableWidgetInstanceGridContext = React.createContext<{
  isEditing: boolean,
}>({
  isEditing: false,
});

function BigIconButton({ icon, children, ...props }: { icon: React.ReactNode } & DesignButtonProps) {
  return (
    <DesignButton
      variant="outline"
      className="h-20 w-20 p-1 rounded-full backdrop-blur-md bg-slate-200/20 dark:bg-black/20"
      {...props}
    >
      {icon}
      {children}
    </DesignButton>
  );
}

export function SwappableWidgetInstanceGrid(props: {
  gridRef: RefState<WidgetInstanceGrid>,
  isSingleColumnMode: boolean | "auto",
  allowVariableHeight: boolean,
  isStatic: boolean,
  availableWidgets?: Widget<any, any>[],
  unitHeight?: number,
  gapPixels?: number,
  fitContent?: boolean,
}) {
  const dispatchGridStateChange = useCallback((grid: WidgetInstanceGrid) => {
    window.dispatchEvent(new CustomEvent('grid-state-change', { detail: { serializedGrid: grid.serialize() } }));
  }, []);

  const effectiveUnitHeight = props.unitHeight ?? gridUnitHeight;
  const effectiveGapPixels = props.gapPixels ?? gridGapPixels;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [resizedElements, setResizedElements] = useState<Set<string>>(new Set());
  const [draggingType, setDraggingType] = useState<"element" | "var-height" | null>(null);
  const [overElementPosition, setOverElementPosition] = useState<[number, number] | null>(null);
  const [overVarHeightSlot, setOverVarHeightSlot] = useState<["before", string] | ["end-of", number] | null>(null);
  const [activeWidgetId, setActiveInstanceId] = useState<string | null>(null);
  const [hoverElementSwap, setHoverElementSwap] = useState<string | null>(null);
  const [hoverSwapBlocked, setHoverSwapBlocked] = useState<string | null>(null);
  const [justSwappedActiveId, setJustSwappedActiveId] = useState<string | null>(null);
  const [justSwappedPartnerId, setJustSwappedPartnerId] = useState<string | null>(null);
  const [resizeBlocked, setResizeBlocked] = useState<{ top: boolean, left: boolean, right: boolean, bottom: boolean }>({ top: false, left: false, right: false, bottom: false });
  const [resizingInstanceId, setResizingInstanceId] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const dropRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const context = React.useContext(SwappableWidgetInstanceGridContext);

  // Built-in listener for window.__layoutEditing (set by iframe boilerplate).
  // This ensures edit mode works even if the AI-generated code doesn't set up
  // the context provider — the grid picks it up directly from the window event.
  const [windowLayoutEditing, setWindowLayoutEditing] = useState(false);
  React.useEffect(() => {
    const handler = () => setWindowLayoutEditing(!!(window as any).__layoutEditing);
    window.addEventListener('layout-edit-change', handler);
    handler();
    return () => window.removeEventListener('layout-edit-change', handler);
  }, []);

  const [windowSelectingForEdit, setWindowSelectingForEdit] = useState(false);
  React.useEffect(() => {
    const handler = () => setWindowSelectingForEdit(!!(window as any).__selectingForEdit);
    window.addEventListener('selecting-for-edit-change', handler);
    handler();
    return () => window.removeEventListener('selecting-for-edit-change', handler);
  }, []);

  const effectiveIsEditing = context.isEditing || windowLayoutEditing;

  useEffect(() => {
    const handler = () => {
      setResizeBlocked({ top: false, left: false, right: false, bottom: false });
      setResizingInstanceId(null);
    };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, []);

  const [isSingleColumnModeIfAuto, setMobileModeIfAuto] = useState<boolean>(false);

  useResizeObserver(gridContainerRef, (entry) => {
    const shouldBeMobileMode = entry.contentRect.width < mobileModeCutoffWidth;
    if (isSingleColumnModeIfAuto !== shouldBeMobileMode) {
      setMobileModeIfAuto(shouldBeMobileMode);
    }
  });

  const isSingleColumnMode = props.isSingleColumnMode === "auto" ? isSingleColumnModeIfAuto : props.isSingleColumnMode;

  let hasAlreadyRenderedEmpty = false;

  const varHeights = props.gridRef.current.varHeights();

  return (
    <TooltipProvider>
      <div
        ref={gridContainerRef}
        style={{
          ...isSingleColumnMode ? {
            display: 'flex',
            flexDirection: 'column',
          } : {
            display: 'grid',
            gridTemplateColumns: `repeat(${props.gridRef.current.width}, 1fr)`,
            gridTemplateRows: `repeat(${2 * props.gridRef.current.height + 1}, auto)`,
          },

          userSelect: 'none',
          WebkitUserSelect: 'none',
          overflow: 'none',

          isolation: 'isolate',
        }}
      >
        {!isSingleColumnMode && !props.fitContent && range(props.gridRef.current.height).map((y) => (
          <div key={y} style={{ height: effectiveUnitHeight, gridColumn: `1 / ${props.gridRef.current.width + 1}`, gridRow: `${2 * y + 2} / ${2 * y + 3}` }} />
        ))}
        <DndContext
          sensors={sensors}
          onDragStart={(event) => {
          setActiveInstanceId(event.active.id as string);
          setDraggingType("var-height");
          }}
          onDragAbort={() => {
          setActiveInstanceId(null);
          setOverVarHeightSlot(null);
          setDraggingType(null);
          }}
          onDragCancel={() => {
          setActiveInstanceId(null);
          setOverVarHeightSlot(null);
          setDraggingType(null);
          }}
          onDragEnd={(event) => {
          setActiveInstanceId(null);
          setOverVarHeightSlot(null);
          setDraggingType(null);

          const activeInstanceId = event.active.id;
          if (event.over) {
            const overLocation = JSON.parse(`${event.over.id}`) as ["before", string] | ["end-of", number];
            if (overLocation[0] === "before") {
              props.gridRef.set(props.gridRef.current.withMovedVarHeightToInstance(activeInstanceId as string, overLocation[1], overLocation[0]));
            } else {
              props.gridRef.set(props.gridRef.current.withMovedVarHeightToEndOf(activeInstanceId as string, overLocation[1]));
            }
          }
          }}
          onDragOver={(event) => {
            const over = event.over;
            if (!over) {
            setOverVarHeightSlot(null);
            } else {
              const overLocation = JSON.parse(`${over.id}`) as ["before", string] | ["end-of", number];
            setOverVarHeightSlot(overLocation);
            }
          }}
          collisionDetection={closestCenter}
        >
          {range(props.gridRef.current.height + 1).map((y) => (
            <div key={y} style={{
              gridColumn: `1 / -1`,
              gridRow: `${2 * y + 1} / ${2 * y + 2}`,
              display: 'flex',
              flexDirection: 'column',
            }}>
              {[...(varHeights.get(y) ?? []), null].map((instance, i) => {
                if (instance !== null && !props.allowVariableHeight) {
                  throw new StackAssertionError("Variable height widgets are not allowed in this component", { instance });
                }
                const location = instance ? ["before", instance.id] as const: ["end-of", y] as const;
                const isOverVarHeightSlot = deepPlainEquals(overVarHeightSlot, location);

                return (
                  <React.Fragment key={i}>
                    {props.gridRef.current.canAddVarHeight(y) && (
                      <div className="relative">
                        <VarHeightSlot isOver={isOverVarHeightSlot} location={location} />
                      </div>
                    )}
                    {instance !== null && (
                      <div
                        style={{
                          margin: effectiveGapPixels / 2,
                        }}
                      >
                        <Draggable
                          isStatic={props.isStatic}
                          type="var-height"
                          widgetInstance={instance}
                          activeWidgetId={activeWidgetId}
                          isEditing={effectiveIsEditing}
                          selectingForEdit={windowSelectingForEdit}
                          isSingleColumnMode={isSingleColumnMode}
                          onDeleteWidget={async () => {
                          props.gridRef.set(props.gridRef.current.withRemovedVarHeight(instance.id));
                          }}
                          settings={getSettings(instance)}
                          setSettings={async (updater) => {
                          props.gridRef.set(props.gridRef.current.withUpdatedVarHeightSettings(instance.id, updater));
                          }}
                          stateRef={mapRefState(
                          props.gridRef,
                          (grid) => {
                            const newInstance = grid.getVarHeightInstanceById(instance.id);
                            return getState(newInstance ?? instance);
                          },
                          (grid, state) => {
                            return props.gridRef.current.withUpdatedVarHeightState(instance.id, state);
                          },
                        )}
                          onResize={() => {
                            throw new StackAssertionError("Cannot resize a var-height widget!");
                          }}
                          x={0}
                          y={y}
                          width={props.gridRef.current.width}
                          height={1}
                          calculateUnitSize={() => {
                            const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                            const gridContainerWidth = gridContainerRect.width;
                            const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * effectiveGapPixels;
                            const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + effectiveGapPixels;
                            return { width: unitWidth, height: effectiveUnitHeight };
                          }}
                        />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          ))}
        </DndContext>
        <DndContext
          sensors={sensors}
          onDragStart={(event) => {
            setActiveInstanceId(event.active.id as string);
            setDraggingType("element");
          }}
          onDragAbort={() => {
            setHoverElementSwap(null);
            setHoverSwapBlocked(null);
            setActiveInstanceId(null);
            setOverElementPosition(null);
            setDraggingType(null);
          }}
          onDragCancel={() => {
            setHoverElementSwap(null);
            setHoverSwapBlocked(null);
            setActiveInstanceId(null);
            setOverElementPosition(null);
            setDraggingType(null);
          }}
          onDragEnd={(event) => {
            const widgetId = event.active.id;
            const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
            if (!widgetElement) {
              throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
            }
            if (event.over) {
              const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
              const overElement = props.gridRef.current.getElementAt(overCoordinates[0], overCoordinates[1]);
              if (overElement.instance === null) {
                // Move to empty space keeping original size, pushing other elements as needed
                const newGrid = props.gridRef.current.withMovedElementTo(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]);
                const activeId = event.active.id as string;
                setJustSwappedActiveId(activeId);
                setTimeout(() => setJustSwappedActiveId(null), 300);
                props.gridRef.set(newGrid);
                dispatchGridStateChange(newGrid);
              } else if (props.gridRef.current.canSwap(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1])) {
                const activeId = event.active.id as string;
                const partnerId = overElement.instance.id;
                setJustSwappedActiveId(activeId);
                setJustSwappedPartnerId(partnerId);
                setTimeout(() => {
                  setJustSwappedActiveId(null);
                  setJustSwappedPartnerId(null);
                }, 300);
                const newGrid = props.gridRef.current.withSwappedElements(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]);
                props.gridRef.set(newGrid);
                dispatchGridStateChange(newGrid);
              } else {
                alert("Cannot swap elements; make sure the new locations are big enough for the widgets");
              }
            }

            setHoverElementSwap(null);
            setHoverSwapBlocked(null);
            setActiveInstanceId(null);
            setOverElementPosition(null);
            setDraggingType(null);
          }}
          onDragOver={(event) => {
            const widgetId = event.active.id;
            const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
            if (!widgetElement) {
              throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
            }
            if (event.over) {
              if (!event.active.rect.current.initial) {
                // not sure when this happens, if ever — skip silently
              } else {
                const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
                const overElement = props.gridRef.current.getElementAt(overCoordinates[0], overCoordinates[1]);
                const overId = overElement.instance?.id;
                if (overElement.instance === null) {
                  // Empty space — always a valid drop target (will use withMovedElementTo)
                  setOverElementPosition(overCoordinates);
                  setHoverElementSwap(null);
                  setHoverSwapBlocked(null);
                } else if (props.gridRef.current.canSwap(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1])) {
                  setOverElementPosition(overCoordinates);
                  if (overId && overId !== widgetId) {
                    setHoverElementSwap(overId);
                    setHoverSwapBlocked(null);
                  } else {
                    setHoverElementSwap(null);
                    setHoverSwapBlocked(null);
                  }
                } else {
                  setOverElementPosition(null);
                  setHoverElementSwap(null);
                  if (overId && overId !== widgetId) {
                    setHoverSwapBlocked(overId);
                  } else {
                    setHoverSwapBlocked(null);
                  }
                }
              }
            } else {
              setOverElementPosition(null);
              setHoverElementSwap(null);
              setHoverSwapBlocked(null);
            }
          }}
          collisionDetection={pointerWithin}
        >
          {props.gridRef.current.elements().map(({ instance, x, y, width, height }) => {
            if (isSingleColumnMode && !instance) {
              if (hasAlreadyRenderedEmpty) return null;
              hasAlreadyRenderedEmpty = true;
            }

            return (
              <ElementSlot
                isSingleColumnMode={isSingleColumnMode}
                key={instance?.id ?? JSON.stringify({ x, y })}
                instanceId={instance?.id}
                dropRectsRef={dropRectsRef}
                isEmpty={!instance}
                isEditing={effectiveIsEditing}
                isOver={overElementPosition?.[0] === x && overElementPosition[1] === y}
                x={x}
                y={y}
                width={width}
                height={height}
                grid={props.gridRef.current}
                gapPixels={effectiveGapPixels}
                minHeight={
                  instance && resizedElements.has(instance.id)
                    ? height * effectiveUnitHeight
                    : !instance && activeWidgetId !== null && (y + height >= props.gridRef.current.height)
                      ? WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT * effectiveUnitHeight
                      : undefined
                }
                isActive={instance?.id === activeWidgetId}
                skipFlip={instance?.id === justSwappedActiveId || instance?.id === justSwappedPartnerId}
                onAddWidget={props.isStatic ? undefined : () => {
                  window.dispatchEvent(new CustomEvent('widget-add-request', {
                    detail: { x, y, width, height }
                  }));
                }}
              >
                {instance && (() => {
                  const elementFitContent = props.fitContent && !resizedElements.has(instance.id);
                  const isHoverSwapped = hoverElementSwap === instance.id;
                  const isSwapBlocked = hoverSwapBlocked === instance.id;
                  return (
                    <Draggable
                      isStatic={props.isStatic}
                      type="element"
                      fitContent={elementFitContent}
                      widgetInstance={instance}
                      activeWidgetId={activeWidgetId}
                      isEditing={effectiveIsEditing}
                      selectingForEdit={windowSelectingForEdit}
                      resizeBlocked={resizingInstanceId === instance.id ? resizeBlocked : undefined}
                      style={isSwapBlocked ? { opacity: 0.5, transform: 'scale(0.95)', outline: '2px solid #ef4444', outlineOffset: '-2px', borderRadius: '8px' } : isHoverSwapped ? { opacity: 0.5, transform: 'scale(0.95)' } : {}}
                      isSingleColumnMode={isSingleColumnMode}
                      onDeleteWidget={async () => {
                    props.gridRef.set(props.gridRef.current.withRemovedElement(x, y));
                      }}
                      settings={getSettings(instance)}
                      setSettings={async (updater) => {
                    props.gridRef.set(props.gridRef.current.withUpdatedElementSettings(x, y, updater));
                      }}
                      stateRef={mapRefState(
                    props.gridRef,
                    (grid) => {
                      const newElement = grid.getElementByInstanceId(instance.id);
                      return getState(newElement?.instance ?? instance);
                    },
                    (grid, state) => grid.withUpdatedElementState(x, y, state),
                  )}
                      onResize={(edges, visualHeight) => {
                        setResizingInstanceId(instance.id);
                        let currentGrid = props.gridRef.current;
                        if (elementFitContent) {
                          setResizedElements(prev => new Set(prev).add(instance.id));
                          if (visualHeight != null) {
                            const snappedHeight = Math.max(
                              WidgetInstanceGrid.MIN_ELEMENT_HEIGHT,
                              Math.ceil(visualHeight / effectiveUnitHeight)
                            );
                            if (snappedHeight !== height) {
                              const snapDelta = { top: 0, left: 0, bottom: snappedHeight - height, right: 0 };
                              const snapClamped = currentGrid.clampElementResize(x, y, snapDelta);
                              if (snapClamped.bottom !== 0) {
                                currentGrid = currentGrid.withResizedElement(x, y, snapClamped);
                              }
                            }
                          }
                        }
                        const { grid: newGrid, achievedDelta, blocked } = currentGrid.withResizedElementAndPush(x, y, edges);
                        props.gridRef.set(newGrid);
                        dispatchGridStateChange(newGrid);
                        setResizeBlocked(blocked);
                        return achievedDelta;
                      }}
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      calculateUnitSize={() => {
                        const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                        const gridContainerWidth = gridContainerRect.width;
                        const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * effectiveGapPixels;
                        const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + effectiveGapPixels;
                        return { width: unitWidth, height: effectiveUnitHeight };
                      }}
                    />
                  );
                })()}
              </ElementSlot>
            );
          })}
        </DndContext>
      </div>
      {effectiveIsEditing && !props.isStatic && (
        <div
          style={{
            margin: effectiveGapPixels / 2,
            minHeight: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT * effectiveUnitHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '8px dotted #88888822',
            borderRadius: '16px',
            opacity: 0,
            animation: 'stack-animation-fade-in 400ms 50ms ease forwards',
          }}
        >
          <BigIconButton
            icon={<Plus size={24} weight="bold" />}
            onClick={() => {
              window.dispatchEvent(new CustomEvent('widget-add-request', {
                detail: {
                  x: 0,
                  y: props.gridRef.current.height,
                  width: props.gridRef.current.width,
                  height: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
                },
              }));
            }}
          />
        </div>
      )}
    </TooltipProvider>
  );
}

export function VarHeightSlot(props: { isOver: boolean, location: readonly ["before", instanceId: string] | readonly ["end-of", y: number] }) {
  const { setNodeRef } = useDroppable({
    id: JSON.stringify(props.location),
  });

  return (
    <div
      {...{ inert: true } as any}
      ref={setNodeRef}
      style={{
        position: 'absolute',
        width: '100%',
        height: 4,
        transform: 'translateY(-50%)',
        backgroundColor: props.isOver ? '#0000ff88' : 'transparent',
      }}
    />
  );
}

export function ElementSlot(props: { isSingleColumnMode: boolean, isOver: boolean, isEditing?: boolean, children: React.ReactNode, style?: React.CSSProperties, x: number, y: number, width: number, height: number, isEmpty: boolean, grid: WidgetInstanceGrid, gapPixels?: number, minHeight?: number, onAddWidget?: () => void, isActive?: boolean, instanceId?: string, dropRectsRef?: React.RefObject<Map<string, DOMRect>>, skipFlip?: boolean }) {
  const { setNodeRef } = useDroppable({
    id: JSON.stringify([props.x, props.y]),
  });

  const divRef = useRef<HTMLDivElement | null>(null);
  const prevRectRef = useRef<DOMRect | null>(null);
  const flipAnimRef = useRef<Animation | null>(null);
  const isActiveRef = useRef(props.isActive);
  isActiveRef.current = props.isActive;

  const mergedRef = useCallback((el: HTMLDivElement | null) => {
    divRef.current = el;
    setNodeRef(el);
  }, [setNodeRef]);

  // Only run when the card's grid position/size actually changes, not on every render.
  // This prevents cancelling in-flight animations on unrelated re-renders (e.g. isOver hover changes).
  useLayoutEffect(() => {
    if (!divRef.current) return;
    const el = divRef.current;

    // Cancel any in-flight FLIP so getBoundingClientRect returns the true CSS position.
    if (flipAnimRef.current) {
      flipAnimRef.current.cancel();
      flipAnimRef.current = null;
    }

    const newRect = el.getBoundingClientRect();

    // Check for a pending drop rect (just-dropped or just-swapped element)
    const dropRect = props.instanceId ? props.dropRectsRef?.current?.get(props.instanceId) : null;
    if (dropRect && props.instanceId) {
      props.dropRectsRef?.current?.delete(props.instanceId);
    }

    const fromRect = dropRect ?? prevRectRef.current;

    if (fromRect && !props.isEmpty && !props.skipFlip) {
      const dx = fromRect.left - newRect.left;
      const dy = fromRect.top - newRect.top;

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        flipAnimRef.current = el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: 150, easing: 'ease-out' },
        );
      }
    }

    prevRectRef.current = newRect;
  }, [props.x, props.y, props.width, props.height, props.instanceId, props.dropRectsRef, props.skipFlip]);

  const gap = props.gapPixels ?? gridGapPixels;
  const meetsMinSize = props.width >= WidgetInstanceGrid.MIN_ELEMENT_WIDTH && props.height >= WidgetInstanceGrid.MIN_ELEMENT_HEIGHT;
  const shouldRenderEmptyIndicator = props.isEmpty && props.isEditing && meetsMinSize;
  const shouldShowPlusButton = shouldRenderEmptyIndicator && !!props.onAddWidget;

  return (
    <div
      ref={mergedRef}
      style={{
        position: 'relative',
        display: 'flex',
        minWidth: 0,
        backgroundColor: props.isOver ? '#88888822' : undefined,
        borderRadius: '8px',
        gridColumn: `${props.x + 1} / span ${props.width}`,
        gridRow: `${2 * props.y + 2} / span ${2 * props.height - 1}`,
        margin: gap / 2,
        minHeight: props.minHeight,
        ...props.style,
      }}
    >
      <style>{`
        @keyframes stack-animation-fade-in {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }
    `}</style>
      {shouldRenderEmptyIndicator && (<>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            border: '8px dotted #88888822',
            borderRadius: '16px',
            animation: 'stack-animation-fade-in 400ms 50ms ease forwards',
            opacity: 0,
          }}
        >
          {shouldShowPlusButton && (
            <BigIconButton icon={<Plus size={24} weight="bold" />} onClick={() => {
              props.onAddWidget!();
            }} />
          )}
        </div>
      </>)}
      {props.children}
    </div>
  );
}
