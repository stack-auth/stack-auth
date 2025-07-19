"use client";

import { PacificaCard } from '@/components/pacifica/card';
import { DndContext, closestCenter, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core';
import useResizeObserver from '@react-hook/resize-observer';
import { range } from '@stackframe/stack-shared/dist/utils/arrays';
import { StackAssertionError, errorToNiceString, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { bundleJavaScript } from '@stackframe/stack-shared/dist/utils/esbuild';
import { Json, isJsonSerializable } from '@stackframe/stack-shared/dist/utils/json';
import { deepPlainEquals, filterUndefined, isNotNull } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { RefState, mapRefState, useRefState } from '@stackframe/stack-shared/dist/utils/react';
import { AsyncResult, Result } from '@stackframe/stack-shared/dist/utils/results';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import { Button, ButtonProps, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, SimpleTooltip, cn } from '@stackframe/stack-ui';
import { ErrorBoundary } from 'next/dist/client/components/error-boundary';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FaBorderNone, FaPen, FaPlus, FaTrash } from 'react-icons/fa';
import * as jsxRuntime from 'react/jsx-runtime';
import { PageLayout } from "../page-layout";

type SerializedWidget = {
  version: 1,
  sourceJs: string,
  compilationResult: Result<string, string>,
  id: string,
};

const widgetGlobals = {
  React,
  jsxRuntime,
  Card: PacificaCard,

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
    format: 'iife',
    externalPackages: {
      'react': 'module.exports = React;',
      'react/jsx-runtime': 'module.exports = jsxRuntime;',
    },
  });
}

async function compileWidget(source: string): Promise<SerializedWidget> {
  const compilationResult = await compileWidgetSource(source);
  return {
    id: generateUuid(),
    version: 1,
    sourceJs: source,
    compilationResult: compilationResult,
  };
}

let compileAndDeserializeTask: Promise<unknown> | null = null;
function useCompileAndDeserializeWidget(source: string) {
  const [compilationResult, setCompilationResult] = useState<AsyncResult<Widget<any, any>, never> & { status: "ok" | "pending" }>(AsyncResult.pending());
  useEffect(() => {
    let isCancelled = false;
    runAsynchronously(async () => {
      setCompilationResult(AsyncResult.pending());
      while (compileAndDeserializeTask) {
        if (isCancelled) return;
        await compileAndDeserializeTask;
      }
      compileAndDeserializeTask = (async () => {
        const serializedWidget = await compileWidget(source);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        if (serializedWidget.compilationResult.status === "error") {
          // if there's a compile error, we want to debounce a little so we don't flash errors while the user is typing
          await wait(500);
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        const widget = await deserializeWidget(serializedWidget);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (isCancelled) return;
        setCompilationResult(AsyncResult.ok(widget));
      })();
      await compileAndDeserializeTask;
      compileAndDeserializeTask = null;
    });
    return () => {
      isCancelled = true;
    };
  }, [source]);
  return compilationResult;
}

function createErrorWidget(id: string, errorMessage: string): Widget<any, any> {
  return {
    id,
    MainComponent: () => (
      <PacificaCard
        style={{ inset: '0', position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: 'red', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {errorMessage}
        </div>
      </PacificaCard>
    ),
    defaultSettings: null as any,
    defaultState: null as any,
  };
}

async function deserializeWidget(serializedWidget: SerializedWidget): Promise<Widget<any, any>> {
  const errorWidget = (errorMessage: string): Widget<any, any> => createErrorWidget(serializedWidget.id, errorMessage);

  if (serializedWidget.compilationResult.status === "ok") {
    const globalsEntries = Object.entries(widgetGlobals);
    const globalsKeys = globalsEntries.map(([key]) => key);
    const globalsValues = globalsEntries.map(([_, value]) => value);
    const compiledJs = serializedWidget.compilationResult.data;
    let widget: Widget<any, any>;
    try {
      widget = await new Promise(resolve => new Function(...globalsKeys, "__STACK_WIDGET_RESOLVE", compiledJs)(...globalsValues, resolve));
    } catch (e) {
      return errorWidget(`Widget failed to run: ${errorToNiceString(e)}`);
    }

    const allowedKeys = Object.entries(widgetExports).filter(([_, v]) => v !== "never").map(([k]) => k);
    const requiredKeys = Object.entries(widgetExports).filter(([_, v]) => v === "required").map(([k]) => k);
    const exports = Object.keys(widget) as (keyof Widget<any, any>)[];
    const notAllowedExports = exports.filter(key => !allowedKeys.includes(key as keyof Widget<any, any>));
    if (notAllowedExports.length > 0) {
      return errorWidget(`Widget has invalid exports: ${notAllowedExports.join(", ")}. Only these exports are allowed: ${Object.entries(widgetExports).filter(([_, v]) => v === "required").map(([k]) => k).join(", ")}`);
    }
    const missingExports = requiredKeys.filter(key => !exports.includes(key as keyof Widget<any, any>));
    if (missingExports.length > 0) {
      return errorWidget(`Widget is missing required exports: ${missingExports.join(", ")}`);
    }

    widget.id = serializedWidget.id;
    return widget;
  } else {
    const errorMessage = serializedWidget.compilationResult.error;
    return errorWidget(`Widget failed to compile: ${errorMessage}`);
  }
}

type Widget<Settings, State> = {
  id: string,
  MainComponent: React.ComponentType<{ settings: Settings, state: State, stateRef: RefState<State>, setState: (updater: (state: State) => State) => void, widthInGridUnits: number, heightInGridUnits: number, isSingleColumnMode: boolean }>,
  SettingsComponent?: React.ComponentType<{ settings: Settings, setSettings: (updater: (settings: Settings) => Settings) => void }>,
  defaultSettings: Settings,
  defaultState: State,
  calculateMinSize?: (options: { settings: Settings, state: State }) => { widthInGridUnits: number, heightInGridUnits: number },
  hasSubGrid?: boolean,
  isHeightVariable?: boolean,
};

const widgetExports: Record<keyof Widget<any, any>, "required" | "optional" | "never" > = {
  "id": "never",
  "MainComponent": "required",
  "SettingsComponent": "optional",
  "defaultSettings": "required",
  "defaultState": "required",
  "calculateMinSize": "optional",
  "hasSubGrid": "optional",
  "isHeightVariable": "optional",
};

type WidgetInstance<Settings = any, State = any> = {
  readonly id: string,
  readonly widget: Widget<Settings, State>,
  /**
   * `undefined` means that the settings have never been set and the default settings should be used; if the default
   * settings change later, so should the settings.
   */
  readonly settingsOrUndefined: Settings | undefined,
  /**
   * See settingsOrUndefined for more information on the meaning of `undefined`.
   */
  readonly stateOrUndefined: State | undefined,
};

export function createWidgetInstance<Settings, State>(widget: Widget<Settings, State>): WidgetInstance<Settings, State> {
  return {
    id: generateUuid(),
    widget,
    settingsOrUndefined: undefined,
    stateOrUndefined: undefined,
  };
}

export function serializeWidgetInstance(widgetInstance: WidgetInstance<any, any>): Json {
  return {
    id: widgetInstance.id,
    widgetId: widgetInstance.widget.id,
    ...(widgetInstance.settingsOrUndefined === undefined ? {} : { settingsOrUndefined: widgetInstance.settingsOrUndefined }),
    ...(widgetInstance.stateOrUndefined === undefined ? {} : { stateOrUndefined: widgetInstance.stateOrUndefined }),
  };
}

export function deserializeWidgetInstance(widgets: Widget<any, any>[], serialized: Json): WidgetInstance<any, any> {
  const serializedAny: any = serialized;
  if (typeof serializedAny !== "object" || serializedAny === null) {
    throw new StackAssertionError(`Serialized widget instance is not an object!`, { serialized });
  }
  if (typeof serializedAny.id !== "string") {
    throw new StackAssertionError(`Serialized widget instance id is not a string!`, { serialized });
  }
  return {
    id: serializedAny.id,
    widget: widgets.find((widget) => widget.id === serializedAny.widgetId) ?? createErrorWidget(serializedAny.id, `Widget ${serializedAny.widgetId} not found. Was it deleted?`),
    settingsOrUndefined: serializedAny.settingsOrUndefined,
    stateOrUndefined: serializedAny.stateOrUndefined,
  };
}

export function getSettings<Settings, State>(widgetInstance: WidgetInstance<Settings, State>): Settings {
  return widgetInstance.settingsOrUndefined === undefined ? widgetInstance.widget.defaultSettings : widgetInstance.settingsOrUndefined;
}

export function getState<Settings, State>(widgetInstance: WidgetInstance<Settings, State>): State {
  return widgetInstance.stateOrUndefined === undefined ? widgetInstance.widget.defaultState : widgetInstance.stateOrUndefined;
}

type GridElement = {
  readonly instance: WidgetInstance | null,
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
    private readonly _varHeights: ReadonlyMap<number, WidgetInstance[]>,
    public readonly width: number,
    private readonly _fixedHeight: number | "auto",
  ) {
    // Do some sanity checks to prevent bugs early
    const allInstanceIds = new Set<string>();
    const checkInstance = (instance: WidgetInstance) => {
      if (allInstanceIds.has(instance.id)) {
        throw new StackAssertionError(`Widget instance ${instance.id} is duplicated!`, { instance });
      }
      allInstanceIds.add(instance.id);
      const settings = getSettings(instance);
      const state = getState(instance);
      if (!isJsonSerializable(settings)) {
        throw new StackAssertionError(`Settings must be JSON serializable`, { instance, settings });
      }
      if (!isJsonSerializable(state)) {
        throw new StackAssertionError(`State must be JSON serializable`, { instance, state });
      }
    };
    for (const element of this._nonEmptyElements) {
      if (element.instance === null) {
        throw new StackAssertionError(`Non-empty element instance is null!`, { element });
      }
      if (element.width < WidgetInstanceGrid.MIN_ELEMENT_WIDTH) {
        throw new StackAssertionError(`Width must be at least ${WidgetInstanceGrid.MIN_ELEMENT_WIDTH}`, { width: element.width, element });
      }
      if (element.height < WidgetInstanceGrid.MIN_ELEMENT_HEIGHT) {
        throw new StackAssertionError(`Height must be at least ${WidgetInstanceGrid.MIN_ELEMENT_HEIGHT}`, { height: element.height, element });
      }
      if (element.x + element.width > width) {
        throw new StackAssertionError(`Element ${element.instance.id} is out of bounds: ${element.x + element.width} > ${width}`, { width, element });
      }
      if (this._fixedHeight !== "auto" && element.y + element.height > this._fixedHeight) {
        throw new StackAssertionError(`Element ${element.instance.id} is out of bounds: ${element.y + element.height} > ${this._fixedHeight}`, { height: this._fixedHeight, element });
      }
      if (element.instance.widget.isHeightVariable) {
        throw new StackAssertionError(`Element ${element.instance.id} is passed in as a grid element, but has a variable height!`, { element });
      }
      checkInstance(element.instance);
    }
    for (const [y, instances] of this._varHeights) {
      if (instances.length === 0) {
        throw new StackAssertionError(`No variable height widgets found at y = ${y}!`, { varHeights: this._varHeights });
      }
      for (const instance of instances) {
        checkInstance(instance);
      }
    }
  }

  public static fromSingleWidgetInstance(widgetInstance: WidgetInstance<any, any>) {
    return WidgetInstanceGrid.fromWidgetInstances([widgetInstance], {
      width: WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH,
      height: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
    });
  }

  public static fromWidgetInstances(widgetInstances: WidgetInstance[], options: { width?: number, height?: number | "auto" } = {}) {
    const width = options.width ?? 24;
    const height = options.height ?? "auto";

    const nonEmptyElements = widgetInstances
      .filter((instance) => !instance.widget.isHeightVariable)
      .map((instance, index) => ({
        instance,
        x: (index * WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH) % width,
        y: Math.floor(index / Math.floor(width / WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH)) * WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
        width: WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH,
        height: WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT,
      }))
      .sort((a, b) => Math.sign(a.x - b.x) + 0.1 * Math.sign(a.y - b.y));

    const allVarHeightsWidgets = widgetInstances.filter((instance) => instance.widget.isHeightVariable);
    const varHeights = new Map(allVarHeightsWidgets.length === 0 ? [] : [[0, allVarHeightsWidgets]]);

    return new WidgetInstanceGrid(
      nonEmptyElements,
      varHeights,
      width,
      height,
    );
  }

  public serialize(): Json {
    const res = {
      className: "WidgetInstanceGrid",
      version: 1,
      width: this.width,
      fixedHeight: this._fixedHeight,
      nonEmptyElements: this._nonEmptyElements.map((element) => ({
        instance: element.instance ? serializeWidgetInstance(element.instance) : null,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })),
      varHeights: [...this._varHeights.entries()].map(([y, instances]) => ({
        y,
        instances: instances.map(serializeWidgetInstance),
      })),
    };

    // as a sanity check, let's serialize as JSON just to make sure it's JSON-serializable
    const afterJsonSerialization = JSON.parse(JSON.stringify(res));
    if (!deepPlainEquals(afterJsonSerialization, res)) {
      throw new StackAssertionError(`WidgetInstanceGrid serialization is not JSON-serializable!`, {
        beforeJsonSerialization: res,
        afterJsonSerialization,
      });
    }

    return res;
  }

  public static fromSerialized(serialized: Json): WidgetInstanceGrid {
    if (typeof serialized !== "object" || serialized === null) {
      throw new StackAssertionError(`WidgetInstanceGrid serialization is not an object or is null!`, { serialized });
    }
    if (!("className" in serialized) || typeof serialized.className !== "string" || serialized.className !== "WidgetInstanceGrid") {
      throw new StackAssertionError(`WidgetInstanceGrid serialization is not a WidgetInstanceGrid!`, { serialized });
    }

    const serializedAny = serialized as any;
    switch (serializedAny.version) {
      case 1: {
        const nonEmptyElements: GridElement[] = serializedAny.nonEmptyElements.map((element: any) => ({
          instance: element.instance ? deserializeWidgetInstance(widgets, element.instance) : null,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
        }));
        const varHeights: Map<number, WidgetInstance[]> = new Map(serializedAny.varHeights.map((entry: any) => [entry.y, entry.instances.map((serialized: any) => deserializeWidgetInstance(widgets, serialized))]));
        return new WidgetInstanceGrid(nonEmptyElements, varHeights, serializedAny.width, serializedAny.fixedHeight);
      }
      default: {
        throw new StackAssertionError(`Unknown WidgetInstanceGrid version ${serializedAny.version}!`, {
          serialized,
        });
      }
    }
  }

  public get height(): number {
    if (this._fixedHeight === "auto") {
      return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)) + WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT;
    } else {
      return this._fixedHeight;
    }
  }

  private static _withEmptyElements(array: (WidgetInstance<any> | null)[][], varHeights: ReadonlyMap<number, WidgetInstance[]>, nonEmptyElements: GridElement[]) {
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
            if (varHeights.has(y2)) {
              break outer;
            }
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

  private _elementsCache: GridElement[] | null = null;
  public elements() {
    if (this._elementsCache === null) {
      this._elementsCache = WidgetInstanceGrid._withEmptyElements(this.as2dArray(), this._varHeights, this._nonEmptyElements);
    }
    return this._elementsCache;
  }

  public varHeights() {
    return this._varHeights;
  }

  private _as2dArrayCache: (WidgetInstance<any> | null)[][] | null = null;
  public as2dArray(): (WidgetInstance<any> | null)[][] {
    if (this._as2dArrayCache !== null) {
      return this._as2dArrayCache;
    }
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
    return this._as2dArrayCache = array;
  }

  public getElementAt(x: number, y: number): GridElement {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      throw new StackAssertionError(`Invalid coordinates for getElementAt: ${x}, ${y}`);
    }
    return [...this.elements()].find((element) => x >= element.x && x < element.x + element.width && y >= element.y && y < element.y + element.height) ?? throwErr(`No element found at ${x}, ${y}`);
  }

  public getElementByInstanceId(id: string): GridElement | null {
    return [...this.elements()].find((element) => element.instance?.id === id) ?? null;
  }

  public getInstanceById(id: string): WidgetInstance<any, any> | null {
    const element = this.getElementByInstanceId(id);
    if (element?.instance) return element.instance;
    const varHeight = this.getVarHeightInstanceById(id);
    if (varHeight) return varHeight;
    return null;
  }

  public getMinResizableSize(): { width: number, height: number } {
    return {
      width: Math.max(1, ...[...this._nonEmptyElements].map(({ x, width }) => x + width)),
      height: Math.max(1, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)),
    };
  }

  public resize(width: number, height: number | "auto") {
    if (this.width === width && this._fixedHeight === height) {
      return this;
    }
    const minSize = this.getMinResizableSize();
    if (width < minSize.width) {
      throw new StackAssertionError(`Width must be at least ${minSize.width}`, { width });
    }
    if (height !== "auto" && height < minSize.height) {
      throw new StackAssertionError(`Height must be at least ${minSize.height}`, { height });
    }
    return new WidgetInstanceGrid(this._nonEmptyElements, this._varHeights, width, height);
  }

  private elementMinSize(element: GridElement) {
    const res = { width: WidgetInstanceGrid.MIN_ELEMENT_WIDTH, height: WidgetInstanceGrid.MIN_ELEMENT_HEIGHT };
    if (element.instance?.widget.calculateMinSize) {
      const minSize = element.instance.widget.calculateMinSize({ settings: element.instance.settingsOrUndefined, state: element.instance.stateOrUndefined });
      if (minSize.widthInGridUnits > element.width || minSize.heightInGridUnits > element.height) {
        throw new StackAssertionError(`Widget ${element.instance.widget.id} has a size of ${element.width}x${element.height}, but calculateMinSize returned a smaller value (${minSize.widthInGridUnits}x${minSize.heightInGridUnits}).`);
      }
      res.width = Math.max(res.width, minSize.widthInGridUnits);
      res.height = Math.max(res.height, minSize.heightInGridUnits);
    }
    return res;
  }

  /**
   * Returns true iff the element can be fit at the given position and size, even if there are other elements in the
   * way.
   */
  private _canFitSize(element: GridElement, x: number, y: number, width: number, height: number) {
    if (x < 0 || x + width > this.width || y < 0 || y + height > this.height) {
      return false;
    }
    const minSize = this.elementMinSize(element);
    if (width < minSize.width || height < minSize.height) {
      return false;
    }
    return true;
  }

  public canSwap(x1: number, y1: number, x2: number, y2: number) {
    const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
    return (elementsToSwap[0].instance !== null ? this._canFitSize(elementsToSwap[0], elementsToSwap[1].x, elementsToSwap[1].y, elementsToSwap[1].width, elementsToSwap[1].height) : true)
      && (elementsToSwap[1].instance !== null ? this._canFitSize(elementsToSwap[1], elementsToSwap[0].x, elementsToSwap[0].y, elementsToSwap[0].width, elementsToSwap[0].height) : true);
  }

  public withSwappedElements(x1: number, y1: number, x2: number, y2: number) {
    if (!this.canSwap(x1, y1, x2, y2)) {
      throw new StackAssertionError(`Cannot swap elements at ${x1}, ${y1} and ${x2}, ${y2}`);
    }

    const elementsToSwap = [this.getElementAt(x1, y1), this.getElementAt(x2, y2)];
    const newElements = [...this.elements()].map((element) => {
      if (element.x === elementsToSwap[0].x && element.y === elementsToSwap[0].y) {
        return { ...element, instance: elementsToSwap[1].instance };
      }
      if (element.x === elementsToSwap[1].x && element.y === elementsToSwap[1].y) {
        return { ...element, instance: elementsToSwap[0].instance };
      }
      return element;
    });
    return new WidgetInstanceGrid(newElements.filter((element) => element.instance !== null), this._varHeights, this.width, this._fixedHeight);
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
  public clampElementResize(x: number, y: number, edgesDelta: { top: number, left: number, bottom: number, right: number }): { top: number, left: number, bottom: number, right: number } {
    const elementToResize = this.getElementAt(x, y);
    const cacheKey = `${elementToResize.x},${elementToResize.y},${JSON.stringify(edgesDelta)}`;
    if (!this._clampResizeCache.has(cacheKey)) {
      const array = this.as2dArray();

      const newX = elementToResize.x + edgesDelta.left;
      const newY = elementToResize.y + edgesDelta.top;
      const newWidth = elementToResize.width - edgesDelta.left + edgesDelta.right;
      const newHeight = elementToResize.height - edgesDelta.top + edgesDelta.bottom;

      const minSize = this.elementMinSize(elementToResize);

      let isAllowed = false;
      if (
        newWidth >= minSize.width
        && newHeight >= minSize.height
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
          edgesDelta.top !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, top: decr(edgesDelta.top) }) : null,
          edgesDelta.left !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, left: decr(edgesDelta.left) }) : null,
          edgesDelta.bottom !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, bottom: decr(edgesDelta.bottom) }) : null,
          edgesDelta.right !== 0 ? this.clampElementResize(x, y, { ...edgesDelta, right: decr(edgesDelta.right) }) : null,
        ].filter(isNotNull);
        let maxScore = 0;
        let bestCandidate: { top: number, left: number, bottom: number, right: number } = { top: 0, left: 0, bottom: 0, right: 0 };
        for (const candidate of candidates) {
          const score = Math.abs(candidate.top) + Math.abs(candidate.left) + Math.abs(candidate.bottom) + Math.abs(candidate.right);
          if (score > maxScore) {
            maxScore = score;
            bestCandidate = candidate;
          }
        }
        this._clampResizeCache.set(cacheKey, bestCandidate);
      }
    }
    return this._clampResizeCache.get(cacheKey)!;
  }

  public withResizedElement(x: number, y: number, edgesDelta: { top: number, left: number, bottom: number, right: number }) {
    const clamped = this.clampElementResize(x, y, edgesDelta);
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
    return new WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
  }

  public withAddedElement(widget: Widget<any, any>, x: number, y: number, width: number, height: number) {
    const newNonEmptyElements = [...this._nonEmptyElements, {
      instance: createWidgetInstance(widget),
      x,
      y,
      width,
      height,
    }];
    return new WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
  }

  private _withUpdatedElementInstance(x: number, y: number, updater: (element: GridElement) => WidgetInstance<any, any> | null) {
    const elementToUpdate = this.getElementAt(x, y);
    const newNonEmptyElements = this._nonEmptyElements
      .map((element) => element.x === elementToUpdate.x && element.y === elementToUpdate.y ? { ...element, instance: updater(element) } : element)
      .filter((element) => element.instance !== null);
    return new WidgetInstanceGrid(newNonEmptyElements, this._varHeights, this.width, this._fixedHeight);
  }

  public withRemovedElement(x: number, y: number) {
    return this._withUpdatedElementInstance(x, y, (element) => null);
  }

  public withUpdatedElementSettings(x: number, y: number, newSettings: any) {
    if (!isJsonSerializable(newSettings)) {
      throw new StackAssertionError(`New settings are not JSON serializable: ${JSON.stringify(newSettings)}`, { newSettings });
    }
    return this._withUpdatedElementInstance(x, y, (element) => element.instance ? { ...element.instance, settingsOrUndefined: newSettings } : throwErr(`No widget instance at ${x}, ${y}`));
  }

  public withUpdatedElementState(x: number, y: number, newState: any) {
    if (!isJsonSerializable(newState)) {
      throw new StackAssertionError(`New state are not JSON serializable: ${JSON.stringify(newState)}`, { newState });
    }
    return this._withUpdatedElementInstance(x, y, (element) => element.instance ? { ...element.instance, stateOrUndefined: newState } : throwErr(`No widget instance at ${x}, ${y}`));
  }

  public getVarHeightInstanceById(id: string): WidgetInstance | undefined {
    return [...this.varHeights()].flatMap(([_, instances]) => instances).find((instance) => instance.id === id);
  }

  private _withUpdatedVarHeightInstance(oldId: string, updater: (instance: WidgetInstance) => WidgetInstance) {
    const newVarHeights = new Map(
      [...this.varHeights()]
        .map(([y, inst]) => [y, inst.map((i) => i.id === oldId ? updater(i) : i)] as const)
    );
    return new WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
  }

  public withUpdatedVarHeightSettings(instanceId: string, newSettingsOrUndefined: any) {
    return this._withUpdatedVarHeightInstance(instanceId, (instance) => ({ ...instance, settingsOrUndefined: newSettingsOrUndefined }));
  }

  public withUpdatedVarHeightState(instanceId: string, newStateOrUndefined: any) {
    return this._withUpdatedVarHeightInstance(instanceId, (instance) => ({ ...instance, stateOrUndefined: newStateOrUndefined }));
  }

  public withRemovedVarHeight(instanceId: string) {
    const newVarHeights = new Map(
      [...this.varHeights()]
        .map(([y, inst]) => [y, inst.filter((i) => i.id !== instanceId)] as const)
        .filter(([_, inst]) => inst.length > 0)
    );
    return new WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
  }

  private _canAddVarHeightCache = new Map<number, boolean>();
  public canAddVarHeight(y: number) {
    if (this._canAddVarHeightCache.has(y)) {
      return this._canAddVarHeightCache.get(y)!;
    }

    let result = true;

    // ensure that there is no other element that intersects with the new var height slot
    for (const element of this.elements()) {
      if (element.y < y && element.y + element.height > y) {
        result = false;
        break;
      }
    }

    this._canAddVarHeightCache.set(y, result);
    return result;
  }

  public withAddedVarHeightWidget(y: number, widget: Widget<any, any>) {
    return this.withAddedVarHeightAtEndOf(y, createWidgetInstance(widget));
  }

  public withAddedVarHeightAtEndOf(y: number, instance: WidgetInstance) {
    if (!this.canAddVarHeight(y)) {
      throw new StackAssertionError(`Cannot add var height instance at ${y}`, { y, instance });
    }
    const newVarHeights = new Map(this._varHeights);
    newVarHeights.set(y, [...(newVarHeights.get(y) ?? []), instance]);
    return new WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
  }

  public withAddedVarHeightAtInstance(instance: WidgetInstance, toInstanceId: string, beforeOrAfter: "before" | "after") {
    const newVarHeights = new Map(
      [...this.varHeights()]
        .map(([y, inst]) => [
          y,
          inst.flatMap((i) => i.id === toInstanceId ? (beforeOrAfter === "before" ? [instance, i] : [i, instance]) : [i])
        ] as const)
    );
    return new WidgetInstanceGrid(this._nonEmptyElements, newVarHeights, this.width, this._fixedHeight);
  }

  public withMovedVarHeightToInstance(oldId: string, toInstanceId: string, beforeOrAfter: "before" | "after") {
    if (toInstanceId === oldId) {
      return this;
    }
    const instance = this.getVarHeightInstanceById(oldId) ?? throwErr(`Widget instance ${oldId} not found in var heights`, { oldId });
    return this.withRemovedVarHeight(oldId).withAddedVarHeightAtInstance(instance, toInstanceId, beforeOrAfter);
  }

  public withMovedVarHeightToEndOf(oldId: string, toY: number) {
    const instance = this.getVarHeightInstanceById(oldId) ?? throwErr(`Widget instance ${oldId} not found in var heights`, { oldId });
    return this.withRemovedVarHeight(oldId).withAddedVarHeightAtEndOf(toY, instance);
  }
}

const widgets: Widget<any, any>[] = [
  {
    id: "$sub-grid",
    MainComponent: ({ widthInGridUnits, heightInGridUnits, stateRef, isSingleColumnMode }) => {
      const widgetGridRef = mapRefState(
        stateRef,
        (state) => WidgetInstanceGrid.fromSerialized(state.serializedGrid),
        (state, grid) => ({
          ...state,
          serializedGrid: grid.serialize(),
        }),
      );
      const [color] = useState("#" + Math.floor(Math.random() * 16777215).toString(16) + "22");

      useEffect(() => {
        const newWidgetGrid = widgetGridRef.current.resize(widthInGridUnits - 1, heightInGridUnits - 1);
        if (newWidgetGrid !== widgetGridRef.current) {
          widgetGridRef.set(newWidgetGrid);
        }
      }, [widthInGridUnits, heightInGridUnits, widgetGridRef]);

      return (
        <div style={{ backgroundColor: color, padding: '16px' }}>
          <SwappableWidgetInstanceGrid
            isSingleColumnMode={isSingleColumnMode ? "auto" : false}
            gridRef={widgetGridRef}
            allowVariableHeight={false}
            isStatic={false}
          />
        </div>
      );
    },
    defaultSettings: {},
    defaultState: {
      serializedGrid: WidgetInstanceGrid.fromWidgetInstances(
        [],
        {
          width: 1,
          height: 1,
        },
      ).serialize(),
    },
    hasSubGrid: true,
    calculateMinSize(options) {
      const grid = WidgetInstanceGrid.fromSerialized(options.state.serializedGrid);
      const minSize = grid.getMinResizableSize();
      return {
        widthInGridUnits: Math.max(minSize.width, WidgetInstanceGrid.MIN_ELEMENT_WIDTH) + 1,
        heightInGridUnits: Math.max(minSize.height, WidgetInstanceGrid.MIN_ELEMENT_HEIGHT) + 1,
      };
    },
  },
  {
    id: "$compile-widget",
    MainComponent: () => {
      const [source, setSource] = useState(deindent`
        export function MainComponent(props) {
          return <Card>Hello, {props.settings.name}!</Card>;
        }

        // export function SettingsComponent(props) {
        //   return <div>Name: <Input value={props.settings.name} onChange={(e) => props.setSettings((settings) => ({ ...settings, name: e.target.value }))} /></div>;
        // }

        export const defaultSettings = {name: "world"};
      `);
      const [compilationResult, setCompilationResult] = useState<Result<string, string> | null>(null);

      return (
        <PacificaCard
          title="Widget compiler"
          subtitle="This is a subtitle"
        >
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
                  id: generateUuid(),
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
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
  },
  {
    id: "$variable-height-widget",
    MainComponent: () => {
      return (
        <PacificaCard
          title="Variable height widget"
          subtitle="This widget has a variable height. It does not follow the regular grid pattern, and always takes up the grid's full width."
        >
          <textarea value="resize me" readOnly />
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
    isHeightVariable: true,
  },
  {
    id: "$widget-builder",
    MainComponent: () => {
      const [source, setSource] = useState(deindent`
        export function MainComponent(props) {
          return <Card>
            Hello, {props.settings.name}!
            You are <input value={props.state.value} onChange={(e) => props.setState((state) => ({ ...state, value: e.target.value }))} /> years old.
          </Card>;
        }

        export function SettingsComponent(props) {
          return <div>Name: <Input value={props.settings.name} onChange={(e) => props.setSettings((settings) => ({ ...settings, name: e.target.value }))} /></div>;
        }

        export const defaultSettings = {name: "world"};
        export const defaultState = {value: 1};
      `);
      const widgetResult = useCompileAndDeserializeWidget(source);
      const widget = widgetResult.status === "ok" ? widgetResult.data : null;
      const [lastWidget, setLastWidget] = useState(widget);
      const widgetInstanceRef = useRefState<WidgetInstance<any, any> | null>(null);
      useEffect(() => {
        if (lastWidget !== widget) {
          if (widget) {
            widgetInstanceRef.set(createWidgetInstance(widget));
          }
          setLastWidget(widget);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [widget]);

      return (
        <PacificaCard
          title="Widget builder"
        >
          <textarea value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%', height: '35%', fontFamily: "monospace" }} />
          {widgetInstanceRef.current && (
            // once widgetInstanceRef.current is non-null once, it is always non-null, so we can cast it below
            <SingleWidget widgetInstanceRef={widgetInstanceRef as any} />
          )}
        </PacificaCard>
      );
    },
    defaultSettings: {},
    defaultState: {},
    hasSubGrid: true,
  },
];


const gridGapPixels = 32;
const gridUnitHeight = 48;
const mobileModeWidgetHeight = 384;
const mobileModeCutoffWidth = 768;

export default function PageClient() {
  const widgetGridRef = useRefState(WidgetInstanceGrid.fromWidgetInstances(widgets.map((w, i) => createWidgetInstance(w))));
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
      <SwappableWidgetInstanceGridContext.Provider value={{ isEditing: isAltDown }}>
        <SwappableWidgetInstanceGrid gridRef={widgetGridRef} isSingleColumnMode="auto" allowVariableHeight={true} isStatic={false} />
      </SwappableWidgetInstanceGridContext.Provider>
    </PageLayout>
  );
}

function SingleWidget(props: {
  widgetInstanceRef: RefState<WidgetInstance<any, any>>,
}) {
  const widgetGridRef = mapRefState(
    props.widgetInstanceRef,
    (widgetInstance) => {
      return WidgetInstanceGrid.fromSingleWidgetInstance(widgetInstance);
    },
    (widgetInstance, grid) => grid.getInstanceById(widgetInstance.id) ?? /* widget deleted, let's reset to last known state */ widgetInstance,
  );

  return (
    <SwappableWidgetInstanceGrid
      gridRef={widgetGridRef}
      isSingleColumnMode={true}
      allowVariableHeight={true}
      isStatic={true}
    />
  );
}

const SwappableWidgetInstanceGridContext = React.createContext<{
  isEditing: boolean,
}>({
  isEditing: false,
});

function SwappableWidgetInstanceGrid(props: { gridRef: RefState<WidgetInstanceGrid>, isSingleColumnMode: boolean | "auto", allowVariableHeight: boolean, isStatic: boolean }) {
  const [draggingType, setDraggingType] = useState<"element" | "var-height" | null>(null);
  const [activeElementInitialRect, setActiveElementInitialRect] = useState<DOMRect | null>(null);  // onDragOver's event.active.rect.current.initial is the initial rect when the *swap* starts, not the drag, so we want to store the initial rect of the drag somewhere
  const [overElementPosition, setOverElementPosition] = useState<[number, number] | null>(null);
  const [overVarHeightSlot, setOverVarHeightSlot] = useState<["before", string] | ["end-of", number] | null>(null);
  const [hoverElementSwap, setHoverElementSwap] = useState<[string, [number, number, number, number, number, number]] | null>(null);
  const [activeWidgetId, setActiveInstanceId] = useState<string | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const context = React.use(SwappableWidgetInstanceGridContext);
  const [isSingleColumnModeIfAuto, setMobileModeIfAuto] = useState<boolean>(false);

  useResizeObserver(gridContainerRef, (entry, observer) => {
    const shouldBeMobileMode = entry.contentRect.width < mobileModeCutoffWidth;
    if (isSingleColumnModeIfAuto !== shouldBeMobileMode) {
      setMobileModeIfAuto(shouldBeMobileMode);
    }
  });

  const isSingleColumnMode = props.isSingleColumnMode === "auto" ? isSingleColumnModeIfAuto : props.isSingleColumnMode;

  let hasAlreadyRenderedEmpty = false;

  const varHeights = props.gridRef.current.varHeights();

  return (
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

        // Create a new stacking context
        isolation: 'isolate',
      }}
    >
      {!isSingleColumnMode && range(props.gridRef.current.height).map((y) => (
        <div key={y} style={{ height: gridUnitHeight, gridColumn: `1 / ${props.gridRef.current.width + 1}`, gridRow: `${2 * y + 2} / ${2 * y + 3}` }} />
      ))}
      <DndContext
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
                        margin: gridGapPixels / 2,
                      }}
                    >
                      <Draggable
                        isStatic={props.isStatic}
                        type="var-height"
                        widgetInstance={instance}
                        activeWidgetId={activeWidgetId}
                        isEditing={context.isEditing}
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
                            return getState(newInstance ?? /* HACK instance has been deleted; let's return the old state */ instance);
                          },
                          (grid, state) => {
                            return props.gridRef.current.withUpdatedVarHeightState(instance.id, state);
                          },
                        )}
                        onResize={(edges) => {
                          throw new StackAssertionError("Cannot resize a var-height widget!");
                        }}
                        x={0}
                        y={y}
                        width={props.gridRef.current.width}
                        height={1}
                        calculateUnitSize={() => {
                          const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                          const gridContainerWidth = gridContainerRect.width;
                          const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * gridGapPixels;
                          const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + gridGapPixels;
                          return { width: unitWidth, height: gridUnitHeight };
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
        onDragStart={(event) => {
          setActiveInstanceId(event.active.id as string);
          setDraggingType("element");
          setActiveElementInitialRect((event.activatorEvent.target as any).getBoundingClientRect());
        }}
        onDragAbort={() => {
          setHoverElementSwap(null);
          setActiveInstanceId(null);
          setOverElementPosition(null);
          setDraggingType(null);
          setActiveElementInitialRect(null);
        }}
        onDragCancel={() => {
          setHoverElementSwap(null);
          setActiveInstanceId(null);
          setOverElementPosition(null);
          setDraggingType(null);
          setActiveElementInitialRect(null);
        }}
        onDragEnd={(event) => {
          setHoverElementSwap(null);
          setActiveInstanceId(null);
          setOverElementPosition(null);
          setDraggingType(null);
          setActiveElementInitialRect(null);

          const widgetId = event.active.id;
          const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
          if (!widgetElement) {
            throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
          }
          if (event.over) {
            const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
            const swapArgs = [widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]] as const;
            if (props.gridRef.current.canSwap(...swapArgs)) {
              const newGrid = props.gridRef.current.withSwappedElements(...swapArgs);
              props.gridRef.set(newGrid);
            } else {
              alert("Cannot swap elements; make sure the new locations are big enough for the widgets");
            }
          }
        }}
        onDragOver={(event) => {
          const widgetId = event.active.id;
          const widgetElement = [...props.gridRef.current.elements()].find(({ instance }) => instance?.id === widgetId);
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
                setHoverElementSwap([overId, [
                  event.over.rect.left - activeElementInitialRect!.left,
                  event.over.rect.top - activeElementInitialRect!.top,
                  activeElementInitialRect!.width,
                  activeElementInitialRect!.height,
                  event.over.rect.width,
                  event.over.rect.height,
                ]]);
              } else {
                  setHoverElementSwap(null);
              }
            }
          } else {
              setOverElementPosition(null);
              setHoverElementSwap(null);
          }
        }}
        collisionDetection={pointerWithin}
      >
        {props.gridRef.current.elements().map(({ instance, x, y, width, height }) => {
          const isHoverSwap = !!hoverElementSwap && !!instance && (hoverElementSwap[0] === instance.id);


          if (isSingleColumnMode && !instance) {
            if (hasAlreadyRenderedEmpty) return null;
            hasAlreadyRenderedEmpty = true;
          }

          return (
            <ElementSlot
              isSingleColumnMode={isSingleColumnMode}
              key={instance?.id ?? JSON.stringify({ x, y })}
              isEmpty={!instance}
              isOver={overElementPosition?.[0] === x && overElementPosition[1] === y}
              x={x}
              y={y}
              width={width}
              height={height}
              grid={props.gridRef.current}
              onAddWidget={() => {
                const availableWidgets = props.allowVariableHeight ? widgets : widgets.filter((widget) => !widget.isHeightVariable);
                const widget = availableWidgets[Math.floor(Math.random() * availableWidgets.length)];
                if (widget.isHeightVariable) {
                  props.gridRef.set(props.gridRef.current.withAddedVarHeightWidget(0, widget));
                } else {
                  props.gridRef.set(props.gridRef.current.withAddedElement(widget, x, y, width, height));
                }
              }}
            >
              {instance && (
                <Draggable
                  isStatic={props.isStatic}
                  type="element"
                  widgetInstance={instance}
                  activeWidgetId={activeWidgetId}
                  isEditing={context.isEditing}
                  style={{
                    transform: isHoverSwap ? `translate(${-hoverElementSwap[1][0]}px, ${-hoverElementSwap[1][1]}px)` : undefined,
                    minWidth: isHoverSwap ? `${hoverElementSwap[1][2]}px` : (hoverElementSwap && activeWidgetId === instance.id ? `${hoverElementSwap[1][4]}px` : undefined),
                    minHeight: isHoverSwap ? `${hoverElementSwap[1][3]}px` : (hoverElementSwap && activeWidgetId === instance.id ? `${hoverElementSwap[1][5]}px` : undefined),
                  }}
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
                      return getState(newElement?.instance ?? /* HACK instance has been deleted; let's return the old state */ instance);
                    },
                    (grid, state) => grid.withUpdatedElementState(x, y, state),
                  )}
                  onResize={(edges) => {
                    const clamped = props.gridRef.current.clampElementResize(x, y, edges);
                    props.gridRef.set(props.gridRef.current.withResizedElement(x, y, clamped));
                    return clamped;
                  }}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  calculateUnitSize={() => {
                    const gridContainerRect = gridContainerRef.current?.getBoundingClientRect() ?? throwErr(`Grid container not found`);
                    const gridContainerWidth = gridContainerRect.width;
                    const gridContainerWidthWithoutGaps = gridContainerWidth - (props.gridRef.current.width - 1) * gridGapPixels;
                    const unitWidth = Math.round(gridContainerWidthWithoutGaps / props.gridRef.current.width) + gridGapPixels;
                    return { width: unitWidth, height: gridUnitHeight };
                  }}
                />
              )}
            </ElementSlot>
          );
        })}
      </DndContext>
    </div>
  );
}

function VarHeightSlot(props: { isOver: boolean, location: readonly ["before", instanceId: string] | readonly ["end-of", y: number] }) {
  const { setNodeRef, active } = useDroppable({
    id: JSON.stringify(props.location),
  });

  return (
    <div
      inert
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

function ElementSlot(props: { isSingleColumnMode: boolean, isOver: boolean, children: React.ReactNode, style?: React.CSSProperties, x: number, y: number, width: number, height: number, isEmpty: boolean, grid: WidgetInstanceGrid, onAddWidget: () => void }) {
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
        minWidth: 0,  // even if the widget is larger, we don't want to take up more width than the grid unit
        backgroundColor: props.isOver ? '#88888822' : undefined,
        borderRadius: '8px',
        gridColumn: `${props.x + 1} / span ${props.width}`,
        gridRow: `${2 * props.y + 2} / span ${2 * props.height - 1}`,
        margin: gridGapPixels / 2,
        minHeight: props.isSingleColumnMode ? mobileModeWidgetHeight : undefined,
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
  type: 'element' | 'var-height',
  widgetInstance: WidgetInstance<any>,
  style?: React.CSSProperties,
  x: number,
  y: number,
  width: number,
  height: number,
  activeWidgetId: string | null,
  isEditing: boolean,
  isSingleColumnMode: boolean,
  onDeleteWidget: () => Promise<void>,
  settings: any,
  setSettings: (settings: any) => Promise<void>,
  stateRef: RefState<any>,
  onResize: (edges: { top: number, left: number, bottom: number, right: number }) => { top: number, left: number, bottom: number, right: number },
  calculateUnitSize: () => { width: number, height: number },
  isStatic: boolean,
}) {
  const [isSettingsOpen, setIsSettingsOpenRaw] = useState(false);
  const [unsavedSettings, setUnsavedSettings] = useState(props.settings);
  const [settingsClosingAnimationCounter, setSettingsClosingAnimationCounter] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingSubGrid, setIsEditingSubGrid] = useState(false);
  const isEditing = props.isEditing && !isEditingSubGrid;
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

  const { attributes, listeners, setNodeRef, transform, isDragging, node: draggableContainerRef } = useDraggable({
    id: props.widgetInstance.id,
    disabled: !isEditing || props.isStatic,
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.isEditing) {
      setIsEditingSubGrid(false);
    }
  }, [props.isEditing]);

  const isFixedHeight = !props.isSingleColumnMode && props.type === "element";

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
        /* note: Chrome and Safari have different behaviors when it comes to whether backface-visibility and/or transform-style is inherited by children, so we ensure it works with the style tag above + transformStyle */
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
          position: 'relative',
          minWidth: '100%',
          minHeight: '100%',
          display: 'flex',

          zIndex: isDragging ? 100000 : 1,

          transition: [
            'border-width 0.1s ease',
            'box-shadow 0.1s ease',
            props.activeWidgetId !== props.widgetInstance.id && (props.activeWidgetId !== null) ? 'transform 0.2s ease, min-width 0.2s ease, min-height 0.2s ease' : undefined,
            props.activeWidgetId === props.widgetInstance.id ? 'min-width 0.2s ease, min-height 0.2s ease' : undefined,
          ].filter(Boolean).join(', '),
          ...filterUndefined(props.style ?? {}),
          transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) ${props.style?.transform ?? ''}`,
        }}
      >
        <div
          className={cn(isDragging && 'bg-white dark:bg-black border-black/20 dark:border-white/20')}
          style={{
            ...isFixedHeight ? {
              position: 'absolute',
              inset: 0,
            } : {
              position: 'relative',
              width: '100%',
              height: '100%',
            },
            overflow: 'hidden',
            flexGrow: 1,
            alignSelf: 'stretch',
            boxShadow: isEditing ? '0 0 32px 0 #8882' : '0 0 0 0 transparent',
            cursor: isDragging ? 'grabbing' : undefined,
            borderRadius: '8px',
            borderWidth: isEditing && !isDragging ? '1px' : '0px',
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

            display: "flex",
            flexDirection: "row",
          }}
        >
          <div
            data-pacifica-children-flex-grow
            data-pacifica-children-min-width-0
            style={{
              flexGrow: 1,
              display: "flex",
              flexDirection: "row",
            }}
          >
            <SwappableWidgetInstanceGridContext.Provider value={{ isEditing: isEditingSubGrid }}>
              <ErrorBoundary errorComponent={(props) => (
                <div className="text-red-500 text-sm p-2 bg-red-500/10 font-mono whitespace-pre-wrap">
                  A runtime error occured while rendering this widget.<br />
                  <br />
                  {props.reset && <button className="text-blue-500 hover:underline" onClick={() => {
                    props.reset!();
                  }}>Reload widget</button>}<br />
                  <br />
                  {errorToNiceString(props.error)}
                </div>
              )}>
                <props.widgetInstance.widget.MainComponent
                  settings={getSettings(props.widgetInstance)}
                  isSingleColumnMode={props.isSingleColumnMode}
                  state={props.stateRef.current}
                  stateRef={props.stateRef}
                  setState={(updater) => props.stateRef.set(updater(props.stateRef.current))}
                  widthInGridUnits={props.width}
                  heightInGridUnits={props.height}
                />
              </ErrorBoundary>
            </SwappableWidgetInstanceGridContext.Provider>
          </div>
          <div
            inert
            style={{
              position: 'absolute',
              inset: 0,
              opacity: isEditing ? 1 : 0,
              transition: 'opacity 0.2s ease',
              // note: Safari has a weird display glitch with transparent background images when animating opacity in a parent element, so we just don't render it while deleting
              backgroundImage: !isDeleting ? 'radial-gradient(circle at top, #ffffff08, #ffffff02), radial-gradient(circle at top right,  #ffffff04, transparent, transparent)' : undefined,
              borderRadius: 'inherit',
            }}
          />
          <div
            inert
            className={cn(isEditing && !isDragging && "bg-white/50 dark:bg-black/50")}
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: isEditing && !isDragging ? 'drop-shadow(0 0 2px) blur(4px)' : 'none',
              borderRadius: 'inherit',
            }}
          />
          {!isDragging && (
            <div
              style={{
                opacity: isEditing ? 1 : 0,
                transition: 'opacity 0.2s ease',
              }}
              inert={!isEditing}
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
                    cursor: isEditing ? 'move' : undefined,
                    position: 'absolute',
                    inset: 0,
                  }}
                />
                {props.widgetInstance.widget.hasSubGrid && <BigIconButton
                  icon={<FaBorderNone size={24} />}
                  loadingStyle="disabled"
                  onClick={async () => {
                    setIsEditingSubGrid(true);
                  }}
                />}
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
              {!props.isStatic && isFixedHeight && [-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => (x !== 0 || y !== 0) && (
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
              <props.widgetInstance.widget.SettingsComponent settings={unsavedSettings} setSettings={setUnsavedSettings} />
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
                  await props.setSettings(unsavedSettings);
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
