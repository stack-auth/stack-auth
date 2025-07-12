"use client";

import { DndContext, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core';
import { range } from '@stackframe/stack-shared/dist/utils/arrays';
import { StackAssertionError, errorToNiceString, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { bundleJavaScript } from '@stackframe/stack-shared/dist/utils/esbuild';
import { deepPlainEquals, filterUndefined, isNotNull } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { InstantStateRef, useInstantState } from '@stackframe/stack-shared/dist/utils/react';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import { Button, ButtonProps, Card, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, SimpleTooltip, cn } from '@stackframe/stack-ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaPen, FaPlus, FaTrash } from 'react-icons/fa';
import * as jsxRuntime from 'react/jsx-runtime';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';

type SerializedWidget = {
  version: 1,
  sourceJs: string,
  compilationResult: Result<string, string>,
};

const widgetGlobals = {
  React,
  jsxRuntime,
  Card,
  Button,
  Input,
};

async function compileWidgetSource(source: string): Promise<Result<string, string>> {
  return await bundleJavaScript({
    "/source.tsx": source,
    "/entry.js": `
      import * as widget from "./source.tsx";
      __STACK_WIDGET_RESOLVE(widget);
    `,
  }, {
    externalPackages: {
      'react': 'module.exports = React;',
      'react/jsx-runtime': 'module.exports = jsxRuntime;',
    },
  });
}

async function deserializeWidget(serializedWidget: SerializedWidget): Promise<Widget<any>> {
  const errorWidget = (errorMessage: string): Widget<any> => ({
    MainComponent: () => <Card style={{ inset: '0', position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {errorMessage}
      </div>
    </Card>,
    defaultSettings: {},
  });

  if (serializedWidget.compilationResult.status === "ok") {
    const globalsEntries = Object.entries(widgetGlobals);
    const globalsKeys = globalsEntries.map(([key]) => key);
    const globalsValues = globalsEntries.map(([_, value]) => value);
    const compiledJs = serializedWidget.compilationResult.data;
    try {
      return await new Promise(resolve => new Function(...globalsKeys, "__STACK_WIDGET_RESOLVE", compiledJs)(...globalsValues, resolve));
    } catch (e) {
      return errorWidget(`Widget failed to run: ${errorToNiceString(e)}`);
    }
  } else {
    const errorMessage = serializedWidget.compilationResult.error;
    return errorWidget(`Widget failed to compile: ${errorMessage}`);
  }
}

type Widget<Settings> = {
  MainComponent: React.ComponentType<{ settings: Settings }>,
  SettingsComponent?: React.ComponentType<{ settings: Settings, onSettingsChange: (settings: Settings) => void }>,
  defaultSettings: Settings,
};

type WidgetInstance<Settings> = {
  readonly id: string,
  readonly widget: Widget<Settings>,
  readonly settings: Settings,
};

type GridElement = {
  readonly instance: WidgetInstance<any> | null,
  readonly x: number,
  readonly y: number,
  readonly width: number,
  readonly height: number,
};

class WidgetInstanceGrid {
  public static readonly DEFAULT_ELEMENT_WIDTH = 12;
  public static readonly DEFAULT_ELEMENT_HEIGHT = 8;

  public static readonly MIN_ELEMENT_WIDTH = 4;
  public static readonly MIN_ELEMENT_HEIGHT = 2;

  private constructor(
    private readonly _nonEmptyElements: GridElement[],
    public readonly width: number,
  ) {}

  public static fromWidgetInstances(widgetInstances: WidgetInstance<any>[]) {
    const width = 24;

    const nonEmptyElements = widgetInstances.map((instance, index) => ({
      instance,
      x: (index * WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH) % width,
      y: Math.floor(index / Math.floor(width / WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH)) * WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
      width: WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH,
      height: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
    }));

    return new WidgetInstanceGrid(
      nonEmptyElements,
      width,
    );
  }

  public get height(): number {
    return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)) + WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT;
  }

  private static _withEmptyElements(array: (WidgetInstance<any> | null)[][], nonEmptyElements: GridElement[]) {
    let result: GridElement[] = [...nonEmptyElements];
    const newArray: (WidgetInstance<any> | null | "empty")[][] = array.map((row, y) => [...row]);
    for (let x1 = 0; x1 < array.length; x1++) {
      for (let y1 = 0; y1 < array[x1].length; y1++) {
        if (newArray[x1][y1] === null) {
          let x2 = x1 + 1;
          while (x2 < array.length && x2 - x1 < WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH) {
            if (newArray[x2][y1] !== null) {
              break;
            }
            x2++;
          }
          let y2 = y1 + 1;
          outer: while (y2 < array[x1].length && y2 - y1 < WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT) {
            for (let xx = x1; xx < x2; xx++) {
              if (newArray[xx][y2] !== null) {
                break outer;
              }
            }
            y2++;
          }
          result.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, instance: null });
          for (let xx = x1; xx < x2; xx++) {
            for (let yy = y1; yy < y2; yy++) {
              newArray[xx][yy] = "empty";
            }
          }
        }
      }
    }
    return result;
  }

  public [Symbol.iterator]() {
    return WidgetInstanceGrid._withEmptyElements(this.as2dArray(), this._nonEmptyElements)[Symbol.iterator]();
  }

  public as2dArray(): (WidgetInstance<any> | null)[][] {
    const array = new Array(this.width).fill(null).map(() => new Array(this.height).fill(null));
    [...this._nonEmptyElements].forEach(({ x, y, width, height, instance }) => {
      if (x + width > this.width) {
        throw new StackAssertionError(`Widget instance ${instance?.id} is out of bounds: ${x + width} > ${this.width}`);
      }
      for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
          array[x + i][y + j] = instance;
        }
      }
    });
    return array;
  }

  public getElementAt(x: number, y: number): GridElement {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new StackAssertionError(`Invalid coordinates for getElementAt: ${x}, ${y}`);
    }
    return [...this].find((element) => x >= element.x && x < element.x + element.width && y >= element.y && y < element.y + element.height) ?? throwErr(`No element found at ${x}, ${y}`);
  }

  public canSwap(x1: number, y1: number, x2: number, y2: number) {
    const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
    const isBigEnough = (element: GridElement) => element.width >= WidgetInstanceGrid.MIN_ELEMENT_WIDTH && element.height >= WidgetInstanceGrid.MIN_ELEMENT_HEIGHT;
    return (elementsToSwap[0].instance !== null ? isBigEnough(elementsToSwap[1]) : true)
      && (elementsToSwap[1].instance !== null ? isBigEnough(elementsToSwap[0]) : true);
  }

  public withSwapped(x1: number, y1: number, x2: number, y2: number) {
    if (!this.canSwap(x1, y1, x2, y2)) {
      throw new StackAssertionError(`Cannot swap elements at ${x1}, ${y1} and ${x2}, ${y2}`);
    }

    const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
    const newElements = [...this].map((element) => {
      if (element.x === elementsToSwap[0].x && element.y === elementsToSwap[0].y) {
        return { ...element, instance: elementsToSwap[1].instance };
      }
      if (element.x === elementsToSwap[1].x && element.y === elementsToSwap[1].y) {
        return { ...element, instance: elementsToSwap[0].instance };
      }
      return element;
    });
    return new WidgetInstanceGrid(newElements.filter((element) => element.instance !== null), this.width);
  }

  private readonly _clampResizeCache = new Map<string, { top: number, left: number, bottom: number, right: number }>();
  /**
   * Given four edge resize deltas (for top/left/bottom/right edges), returns deltas that are smaller or the same as the
   * input deltas, would prevent any collisions with other elements. If there are multiple possible return values,
   * returns any one such that it can not be increased in any dimension.
   *
   * For example, if the element is at (2, 2) with width 1 and height 1, and the edgesDelta is
   * { top: 1, left: 1, bottom: 1, right: 1 }, then the new element would be at (3, 3) with width 1 and height 1.
   * However, if there is already an element at (3, 3), then this function would return
   * { top: 0, left: 1, bottom: 0, right: 1 } or { top: 1, left: 0, bottom: 1, right: 0 }.
   *
   */
  public clampResize(x: number, y: number, edgesDelta: { top: number, left: number, bottom: number, right: number }): { top: number, left: number, bottom: number, right: number } {
    const elementToResize = this.getElementAt(x, y);
    const cacheKey = `${elementToResize.x},${elementToResize.y},${JSON.stringify(edgesDelta)}`;
    if (!this._clampResizeCache.has(cacheKey)) {
      const array = this.as2dArray();

      const newX = elementToResize.x + edgesDelta.left;
      const newY = elementToResize.y + edgesDelta.top;
      const newWidth = elementToResize.width - edgesDelta.left + edgesDelta.right;
      const newHeight = elementToResize.height - edgesDelta.top + edgesDelta.bottom;

      let isAllowed = false;
      if (
        newWidth >= WidgetInstanceGrid.MIN_ELEMENT_WIDTH
        && newHeight >= WidgetInstanceGrid.MIN_ELEMENT_HEIGHT
        && newX >= 0
        && newY >= 0
        && newX + newWidth <= this.width
        && newY + newHeight <= this.height
      ) {
        isAllowed = true;
        outer: for (let i = 0; i < newWidth; i++) {
          for (let j = 0; j < newHeight; j++) {
            if (array[newX + i][newY + j] !== null && array[newX + i][newY + j] !== elementToResize.instance) {
              isAllowed = false;
              break outer;
            }
          }
        }
      }

      if (isAllowed) {
        this._clampResizeCache.set(cacheKey, edgesDelta);
      } else {
        const decr = (i: number) => i > 0 ? i - 1 : i < 0 ? i + 1 : i;
        const candidates = [
          edgesDelta.top !== 0 ? this.clampResize(x, y, { ...edgesDelta, top: decr(edgesDelta.top) }) : null,
          edgesDelta.left !== 0 ? this.clampResize(x, y, { ...edgesDelta, left: decr(edgesDelta.left) }) : null,
          edgesDelta.bottom !== 0 ? this.clampResize(x, y, { ...edgesDelta, bottom: decr(edgesDelta.bottom) }) : null,
          edgesDelta.right !== 0 ? this.clampResize(x, y, { ...edgesDelta, right: decr(edgesDelta.right) }) : null,
        ].filter(isNotNull);
        let maxScore = -1;
        let bestCandidate: { top: number, left: number, bottom: number, right: number } | null = null;
        for (const candidate of candidates) {
          const score = Math.abs(candidate.top) + Math.abs(candidate.left) + Math.abs(candidate.bottom) + Math.abs(candidate.right);
          if (score > maxScore) {
            maxScore = score;
            bestCandidate = candidate;
          }
        }
        if (!bestCandidate) {
          throw new StackAssertionError(`No candidate found for ${cacheKey}`);
        }
        this._clampResizeCache.set(cacheKey, bestCandidate);
      }
    }
    return this._clampResizeCache.get(cacheKey)!;
  }

  public withResized(x: number, y: number, edgesDelta: { top: number, left: number, bottom: number, right: number }) {
    const clamped = this.clampResize(x, y, edgesDelta);
    if (!deepPlainEquals(clamped, edgesDelta)) {
      throw new StackAssertionError(`Resize is not allowed: ${JSON.stringify(edgesDelta)} requested, but only ${JSON.stringify(clamped)} allowed`);
    }

    // performance optimization: if there is no change, return the same grid
    // this retains the _clampResizeCache on the returned grid and makes things significantly faster
    if (clamped.top === 0 && clamped.left === 0 && clamped.bottom === 0 && clamped.right === 0) return this;

    const elementToResize = this.getElementAt(x, y);
    const newNonEmptyElements = [...this._nonEmptyElements].map((element) => {
      if (element.x === elementToResize.x && element.y === elementToResize.y) {
        return {
          ...element,
          x: element.x + clamped.left,
          y: element.y + clamped.top,
          width: element.width - clamped.left + clamped.right,
          height: element.height - clamped.top + clamped.bottom,
        };
      }
      return element;
    });
    return new WidgetInstanceGrid(newNonEmptyElements, this.width);
  }

  public withAdded(widget: Widget<any>, x: number, y: number, width: number, height: number) {
    const newNonEmptyElements = [...this._nonEmptyElements, {
      instance: {
        id: generateUuid(),
        widget,
        settings: widget.defaultSettings,
      },
      x,
      y,
      width,
      height,
    }];
    return new WidgetInstanceGrid(newNonEmptyElements, this.width);
  }

  public withRemoved(x: number, y: number) {
    const elementToRemove = this.getElementAt(x, y);
    const newNonEmptyElements = this._nonEmptyElements.filter((element) => element.x !== elementToRemove.x || element.y !== elementToRemove.y);
    return new WidgetInstanceGrid(newNonEmptyElements, this.width);
  }

  public withUpdatedSettings(x: number, y: number, settings: any) {
    const elementToUpdate = this.getElementAt(x, y);
    const newNonEmptyElements = this._nonEmptyElements.map((element) => element.x === elementToUpdate.x && element.y === elementToUpdate.y ? { ...element, instance: element.instance ? { ...element.instance, settings } : null } : element);
    return new WidgetInstanceGrid(newNonEmptyElements, this.width);
  }
}

const widgets: Widget<any>[] = [
  {
    MainComponent: () => {
      const [source, setSource] = useState(deindent`
        export function MainComponent(props) {
          return <Card>Hello, {props.settings.name}!</Card>;
        }

        // export function SettingsComponent(props) {
        //   return <div>Name: <Input value={props.settings.name} onChange={(e) => props.onSettingsChange({ ...props.settings, name: e.target.value })} /></div>;
        // }

        export const defaultSettings = {name: "world"};
      `);
      const stackAdminApp = useAdminApp();
      const [compilationResult, setCompilationResult] = useState<Result<string, string> | null>(null);

      return (
        <Card style={{ inset: '0', position: 'absolute' }}>
          <textarea value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%', height: '35%', fontFamily: "monospace" }} />
          <Button onClick={async () => {
            const result = await compileWidgetSource(source);
            setCompilationResult(result);
          }}>Compile</Button>
          {compilationResult?.status === "ok" && (
            <>
              <textarea style={{ fontFamily: "monospace", width: '100%', height: '35%' }} value={compilationResult.data} readOnly />
              <Button onClick={async () => {
                widgets.push(await deserializeWidget({
                  version: 1,
                  sourceJs: compilationResult.data,
                  compilationResult: Result.ok(compilationResult.data),
                }));
                alert("Widget saved");
              }}>Save as widget</Button>
            </>
          )}
          {compilationResult?.status === "error" && (
            <div style={{ color: "red" }}>
              {compilationResult.error}
            </div>
          )}
        </Card>
      );
    },
    defaultSettings: {},
  },
];

const widgetInstances: WidgetInstance<any>[] = [];

const gridGapPixels = 32;

export default function PageClient() {
  const [widgetGridRef, setWidgetGrid] = useInstantState(WidgetInstanceGrid.fromWidgetInstances(widgetInstances));
  const [isAltDown, setIsAltDown] = useState(false);

  useEffect(() => {
    const downListener = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltDown(true);
      }
    };
    const upListener = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsAltDown(false);
      }
    };
    window.addEventListener('keydown', downListener);
    window.addEventListener('keyup', upListener);
    return () => {
      window.removeEventListener('keydown', downListener);
      window.removeEventListener('keyup', upListener);
    };
  }, []);

  return (
    <PageLayout
      title="Widget Playground"
      fillWidth
    >
      <SwappableWidgetInstanceGrid gridRef={widgetGridRef} setGrid={setWidgetGrid} isEditing={isAltDown} />
    </PageLayout>
  );
}

function SwappableWidgetInstanceGrid(props: { gridRef: InstantStateRef<WidgetInstanceGrid>, setGrid: (grid: WidgetInstanceGrid) => void, isEditing: boolean }) {
  const [overElementPosition, setOverElementPosition] = useState<[number, number] | null>(null);
  const [hoverSwap, setHoverSwap] = useState<[string, [number, number, number, number, number, number]] | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  return (
    <DndContext
      onDragStart={(event) => {
        setActiveWidgetId(event.active.id as string);
      }}
      onDragEnd={(event) => {
        setHoverSwap(null);
        setActiveWidgetId(null);
        setOverElementPosition(null);

        const widgetId = event.active.id;
        const widgetElement = [...props.gridRef.current].find(({ instance }) => instance?.id === widgetId);
        if (!widgetElement) {
          throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
        }
        if (event.over) {
          const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
          const swapArgs = [widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]] as const;
          if (props.gridRef.current.canSwap(...swapArgs)) {
            const newGrid = props.gridRef.current.withSwapped(...swapArgs);
            props.setGrid(newGrid);
          }
        }
      }}
      onDragOver={(event) => {
        const widgetId = event.active.id;
        const widgetElement = [...props.gridRef.current].find(({ instance }) => instance?.id === widgetId);
        if (!widgetElement) {
          throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
        }
        if (event.over) {
          if (!event.active.rect.current.initial) {
            // not sure when this happens, if ever. let's ignore it in prod, throw in dev
            if (process.env.NODE_ENV === 'development') {
              throw new StackAssertionError("Active element has no initial rect. Not sure when this happens, so please report it");
            }
          } else {
            const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
            if (props.gridRef.current.canSwap(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1])) {
              setOverElementPosition([overCoordinates[0], overCoordinates[1]]);
            } else {
              setOverElementPosition(null);
            }
            const overId = props.gridRef.current.getElementAt(overCoordinates[0], overCoordinates[1]).instance?.id;
            if (overId && overId !== widgetId) {
              console.log(event.over.rect, event.active.rect.current.initial);
              setHoverSwap([overId, [
                event.over.rect.left - event.active.rect.current.initial.left,
                event.over.rect.top - event.active.rect.current.initial.top,
                event.active.rect.current.initial.width,
                event.active.rect.current.initial.height,
                event.over.rect.width,
                event.over.rect.height,
              ]]);
            } else {
              setHoverSwap(null);
            }
          }
        } else {
          setOverElementPosition(null);
          setHoverSwap(null);
        }
      }}
      collisionDetection={pointerWithin}
    >
      <div
        ref={gridContainerRef}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${props.gridRef.current.width}, 1fr)`,
          gridTemplateRows: `repeat(${props.gridRef.current.height}, 1fr)`,
          gap: gridGapPixels,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {range(props.gridRef.current.height).map((y) => (
          <div key={y} style={{ height: '16px', gridColumn: `1 / ${props.gridRef.current.width + 1}`, gridRow: `${y + 1} / ${y + 2}` }} />
        ))}
        {[...props.gridRef.current].map(({ instance, x, y, width, height }) => {
          const isHoverSwap = !!hoverSwap && !!instance && (hoverSwap[0] === instance.id);
          return (
            <Droppable
              key={instance?.id ?? JSON.stringify({ x, y, width, height })}
              isEmpty={!instance}
              isOver={overElementPosition?.[0] === x && overElementPosition[1] === y}
              x={x}
              y={y}
              width={width}
              height={height}
              grid={props.gridRef.current}
              onAddWidget={() => {
                props.setGrid(props.gridRef.current.withAdded(widgets[Math.floor(Math.random() * widgets.length)], x, y, width, height));
              }}
            >
              {instance && (
                <Draggable
                  widgetInstance={instance}
                  activeWidgetId={activeWidgetId}
                  isEditing={props.isEditing}
                  style={{
                    transform: isHoverSwap ? `translate(${-hoverSwap[1][0]}px, ${-hoverSwap[1][1]}px)` : undefined,
                    width: isHoverSwap ? `${hoverSwap[1][2]}px` : (hoverSwap && activeWidgetId === instance.id ? `${hoverSwap[1][4]}px` : undefined),
                    height: isHoverSwap ? `${hoverSwap[1][3]}px` : (hoverSwap && activeWidgetId === instance.id ? `${hoverSwap[1][5]}px` : undefined),
                  }}
                  onDeleteWidget={async () => {
                    props.setGrid(props.gridRef.current.withRemoved(x, y));
                  }}
                  settings={instance.settings}
                  onSaveSettings={async (settings) => {
                    props.setGrid(props.gridRef.current.withUpdatedSettings(x, y, settings));
                  }}
                  onResize={(edges) => {
                    const clamped = props.gridRef.current.clampResize(x, y, edges);
                    props.setGrid(props.gridRef.current.withResized(x, y, clamped));
                    return clamped;
                  }}
                  calculateUnitSize={() => {
                    const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                    const gridContainerWidth = gridContainerRect.width;
                    const gridContainerHeight = gridContainerRect.height;
                    const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * gridGapPixels;
                    const gridContainerHeightWithoutGaps = gridContainerHeight - (props.gridRef.current.height - 1) * gridGapPixels;
                    const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + gridGapPixels;
                    const unitHeight = Math.round(gridContainerHeightWithoutGaps / props.gridRef.current.height) + gridGapPixels;
                    return { width: unitWidth, height: unitHeight };
                  }}
                />
              )}
            </Droppable>
          );
        })}
      </div>
    </DndContext>
  );
}

function Droppable(props: { isOver: boolean, children: React.ReactNode, style?: React.CSSProperties, x: number, y: number, width: number, height: number, isEmpty: boolean, grid: WidgetInstanceGrid, onAddWidget: () => void }) {
  const { setNodeRef, active } = useDroppable({
    id: JSON.stringify([props.x, props.y]),
  });

  const shouldRenderAddWidget = props.isEmpty && props.width >= WidgetInstanceGrid.MIN_ELEMENT_WIDTH && props.height >= WidgetInstanceGrid.MIN_ELEMENT_HEIGHT;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'relative',
        display: 'flex',
        backgroundColor: props.isOver ? '#88888822' : undefined,
        borderRadius: '8px',
        gridColumn: `${props.x + 1} / span ${props.width}`,
        gridRow: `${props.y + 1} / span ${props.height}`,
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
      {shouldRenderAddWidget && (<>
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
          <BigIconButton icon={<FaPlus size={24} opacity={0.7} />} onClick={() => {
            props.onAddWidget();
          }} />
        </div>
      </>)}
      {props.children}
    </div>
  );
}

function Draggable(props: {
  widgetInstance: WidgetInstance<any>,
  style: React.CSSProperties,
  activeWidgetId: string | null,
  isEditing: boolean,
  onDeleteWidget: () => Promise<void>,
  settings: any,
  onSaveSettings: (settings: any) => Promise<void>,
  onResize: (edges: { top: number, left: number, bottom: number, right: number }) => { top: number, left: number, bottom: number, right: number },
  calculateUnitSize: () => { width: number, height: number },
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging, node: draggableContainerRef } = useDraggable({
    id: props.widgetInstance.id,
    disabled: !props.isEditing,
  });
  const [isSettingsOpen, setIsSettingsOpenRaw] = useState(false);
  const [unsavedSettings, setUnsavedSettings] = useState(props.settings);
  const [settingsClosingAnimationCounter, setSettingsClosingAnimationCounter] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [settingsOpenAnimationDetails, setSettingsOpenAnimationDetails] = useState<{
    translate: readonly [number, number],
    scale: readonly [number, number],
    shouldStart: boolean,
    revert: boolean,
  } | null>(null);

  const setIsSettingsOpen = useCallback((value: boolean) => {
    if (value) {
      setSettingsOpenAnimationDetails(null);
      setUnsavedSettings(props.settings);
      setIsSettingsOpenRaw(true);
    } else {
      setSettingsOpenAnimationDetails(settingsOpenAnimationDetails ? { ...settingsOpenAnimationDetails, revert: true } : null);
      setIsSettingsOpenRaw(false);
      setSettingsClosingAnimationCounter(c => c + 1);
      setTimeout(() => setSettingsClosingAnimationCounter(c => c - 1), 1000);
    }
  }, [settingsOpenAnimationDetails, props.settings]);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (isSettingsOpen) {
      if (!settingsOpenAnimationDetails) {
        runAsynchronouslyWithAlert(async () => {
          // we want to wait asynchronously with starting the animations until the dialog is mounted, otherwise we can't sync up the animations
          if (!draggableContainerRef.current) throw new StackAssertionError("Draggable container not found", { draggableContainerRef });
          for (let i = 0; i < 100; i++) {
            if (cancelled) return;
            if (dialogRef.current) break;
            await wait(10 + 3 * i);
          }
          if (!dialogRef.current) throw new StackAssertionError("Dialog ref not found even after waiting", { dialogRef });
          if (cancelled) return;

          const draggableContainerRect = draggableContainerRef.current.getBoundingClientRect();
          const dialogRect = dialogRef.current.getBoundingClientRect();
          const draggableContainerCenterCoordinates = [
            draggableContainerRect.x + draggableContainerRect.width / 2,
            draggableContainerRect.y + draggableContainerRect.height / 2,
          ] as const;
          const dialogCenterCoordinates = [
            dialogRect.x + dialogRect.width / 2,
            dialogRect.y + dialogRect.height / 2,
          ] as const;
          const scale = [
            draggableContainerRect.width / dialogRect.width,
            draggableContainerRect.height / dialogRect.height,
          ] as const;
          const translate = [
            draggableContainerCenterCoordinates[0] - dialogCenterCoordinates[0],
            draggableContainerCenterCoordinates[1] - dialogCenterCoordinates[1],
          ] as const;

          setSettingsOpenAnimationDetails({
            translate,
            scale,
            shouldStart: false,
            revert: false,
          });
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [isSettingsOpen, settingsOpenAnimationDetails, draggableContainerRef]);

  useEffect(() => {
    let cancelled = false;
    if (settingsOpenAnimationDetails && !settingsOpenAnimationDetails.shouldStart) {
      requestAnimationFrame(() => {
        runAsynchronously(async () => {
          if (cancelled) return;
          setSettingsOpenAnimationDetails({ ...settingsOpenAnimationDetails, shouldStart: true });
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [settingsOpenAnimationDetails]);

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return (
    <>
      <style>{`
        /* note: Chrome and Safari have inconsistent behavior where backface-visibility and/or transform-style is not inherited by children, so we ensure it works with the style tag above + transformStyle */
        .stack-recursive-backface-hidden {
          backface-visibility: hidden;
          ${isSafari ? '' : 'transform-style: preserve-3d;'}
        }
        .stack-recursive-backface-hidden * {
          backface-visibility: hidden;
        }
      `}</style>
      <div
        ref={setNodeRef}
        className="stack-recursive-backface-hidden"
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          display: 'flex',

          zIndex: isDragging ? 100000 : undefined,

          transition: [
            'border-width 0.1s ease',
            'box-shadow 0.1s ease',
            props.activeWidgetId !== props.widgetInstance.id && (props.activeWidgetId !== null) ? 'transform 0.2s ease, width 0.2s ease, height 0.2s ease' : undefined,
            props.activeWidgetId === props.widgetInstance.id ? 'width 0.2s ease, height 0.2s ease' : undefined,
          ].filter(Boolean).join(', '),
          ...filterUndefined(props.style),
          transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) ${props.style.transform ?? ''}`,
        }}
      >
        <div
          className={cn(isDragging && 'bg-white dark:bg-black border-black/20 dark:border-white/20')}
          style={{
            position: 'relative',
            flexGrow: 1,
            alignSelf: 'stretch',
            boxShadow: props.isEditing ? '0 0 32px 0 #8882' : '0 0 0 0 transparent',
            cursor: isDragging ? 'grabbing' : undefined,
            borderRadius: '8px',
            borderWidth: props.isEditing && !isDragging ? '1px' : '0px',
            borderStyle: 'solid',

            transition: isDeleting ? `transform 0.3s ease, opacity 0.3s` : `transform 0.6s ease`,
            transform: [
              settingsOpenAnimationDetails?.shouldStart && !settingsOpenAnimationDetails.revert ? `
                translate(${-settingsOpenAnimationDetails.translate[0]}px, ${-settingsOpenAnimationDetails.translate[1]}px)
                scale(${1/settingsOpenAnimationDetails.scale[0]}, ${1/settingsOpenAnimationDetails.scale[1]})
                rotateY(180deg)
              ` : 'rotateY(0deg)',
              isDeleting ? 'scale(0.8)' : '',
            ].filter(Boolean).join(' '),
            opacity: isDeleting ? 0 : 1,
          }}
        >
          <div
            style={{
            }}
          >
            <props.widgetInstance.widget.MainComponent settings={props.widgetInstance.settings} />
          </div>
          <div
            inert
            style={{
              position: 'absolute',
              inset: 0,
              opacity: props.isEditing ? 1 : 0,
              transition: 'opacity 0.2s ease',
              // note: Safari has a weird display glitch with transparent background images when animating opacity in a parent element, so we just don't render it while deleting
              backgroundImage: !isDeleting ? 'radial-gradient(circle at top, #ffffff08, #ffffff02), radial-gradient(circle at top right,  #ffffff04, transparent, transparent)' : undefined,
            }}
          />
          <div
            inert
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: props.isEditing && !isDragging ? 'blur(1px)' : 'none',
            }}
          />
          {!isDragging && (
            <div
              style={{
                opacity: props.isEditing ? 1 : 0,
                transition: 'opacity 0.2s ease',
              }}
              inert={!props.isEditing}
            >
              <div
                className=""
                style={{
                  position: 'absolute',
                  inset: 0,

                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '16px',
                }}
              >
                <div
                  {...listeners}
                  {...attributes}
                  style={{
                    cursor: props.isEditing ? 'move' : undefined,
                    position: 'absolute',
                    inset: 0,
                  }}
                />
                <SimpleTooltip tooltip={!props.widgetInstance.widget.SettingsComponent ? "This widget doesn't have any settings." : undefined}>
                  <BigIconButton disabled={!props.widgetInstance.widget.SettingsComponent} icon={<FaPen size={24} />} onClick={async () => {
                    setIsSettingsOpen(true);
                  }} />
                </SimpleTooltip>
                <BigIconButton
                  icon={<FaTrash size={24} />}
                  loadingStyle="disabled"
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      await wait(300);
                      await props.onDeleteWidget();
                    } catch (e) {
                      // in case something went wrong with the delete, we want to reset the state
                      setIsDeleting(false);
                      throw e;
                    }
                  }}
                />
              </div>
              {[-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => (x !== 0 || y !== 0) && (
                <ResizeHandle
                  key={`${x},${y}`}
                  widgetInstance={props.widgetInstance}
                  x={x}
                  y={y}
                  onResize={props.onResize}
                  calculateUnitSize={props.calculateUnitSize}
                />
              )))}
            </div>
          )}
        </div>
      </div>
      {props.widgetInstance.widget.SettingsComponent && (
        <Dialog open={isSettingsOpen || settingsClosingAnimationCounter > 0} onOpenChange={setIsSettingsOpen}>
          <DialogContent
            ref={dialogRef}
            overlayProps={{
              style: {
                opacity: settingsOpenAnimationDetails?.shouldStart && !settingsOpenAnimationDetails.revert ? 1 : 0,
                transition: `opacity 0.4s ease`,
                animation: 'none',
              },
            }}
            style={{
              transform: [
                'translate(-50%, -50%)',
                !settingsOpenAnimationDetails ? `` : (
                  settingsOpenAnimationDetails.shouldStart && !settingsOpenAnimationDetails.revert ? `rotateY(0deg)` : `
                    translate(${settingsOpenAnimationDetails.translate[0]}px, ${settingsOpenAnimationDetails.translate[1]}px)
                    scale(${settingsOpenAnimationDetails.scale[0]}, ${settingsOpenAnimationDetails.scale[1]})
                    rotateY(180deg)
                  `
                ),
              ].filter(Boolean).join(' '),
              transition: settingsOpenAnimationDetails?.shouldStart ? 'transform 0.6s ease' : 'none',
              visibility: settingsOpenAnimationDetails ? 'visible' : 'hidden',
              animation: 'none',
            }}
            inert={!isSettingsOpen}
            onInteractOutside={(e) => e.preventDefault()}
            className="[&>button]:hidden stack-recursive-backface-hidden"
          >
            <DialogHeader>
              <DialogTitle className="flex items-center">
                Edit Widget
              </DialogTitle>
            </DialogHeader>

            <DialogBody className="pb-2">
              <props.widgetInstance.widget.SettingsComponent settings={unsavedSettings} onSettingsChange={setUnsavedSettings} />
            </DialogBody>


            <DialogFooter className="gap-2">
              <Button
                variant="secondary"
                color="neutral"
                onClick={async () => {
                  setIsSettingsOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={async () => {
                  await props.onSaveSettings(unsavedSettings);
                  setIsSettingsOpen(false);
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function BigIconButton({ icon, children, ...props }: { icon: React.ReactNode} & ButtonProps) {
  return (
    <Button
      variant="outline"
      className={cn("h-20 w-20 p-1 rounded-full backdrop-blur-md bg-white/20 dark:bg-black/20")}
      {...props}
    >
      {icon}
      {children}
    </Button>
  );
}

function ResizeHandle({ widgetInstance, x, y, ...props }: {
  widgetInstance: WidgetInstance<any>,
  x: number,
  y: number,
  onResize: (edges: { top: number, left: number, bottom: number, right: number }) => { top: number, left: number, bottom: number, right: number },
  calculateUnitSize: () => { width: number, height: number },
}) {
  const [dragBaseCoordinates, setDragBaseCoordinates] = useInstantState<[number, number] | null>(null);
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
        setDragBaseCoordinates([
          dragBaseCoordinates.current[0] + (resizeResult.left + resizeResult.right) * unitWidth,
          dragBaseCoordinates.current[1] + (resizeResult.top + resizeResult.bottom) * unitHeight,
        ]);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [x, y, props.onResize, props.calculateUnitSize, dragBaseCoordinates, setDragBaseCoordinates]);

  const onResizeRef = useRef(props.onResize);
  onResizeRef.current = props.onResize;

  const calculateUnitSizeRef = useRef(props.calculateUnitSize);
  calculateUnitSizeRef.current = props.calculateUnitSize;

  return (
    <div
      className="border-black dark:border-white"
      style={{
        position: 'absolute',
        zIndex: 100000,

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
        setDragBaseCoordinates([event.clientX, event.clientY]);
        window.addEventListener('mouseup', () => {
          setDragBaseCoordinates(null);
        }, { once: true });
        event.preventDefault();
        event.stopPropagation();
        return false;
      }}
    ></div>
  );
}
