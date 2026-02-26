"use client";

import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { Json, isJsonSerializable } from '@stackframe/stack-shared/dist/utils/json';
import { deepPlainEquals, isNotNull } from '@stackframe/stack-shared/dist/utils/objects';
import {
  Widget,
  WidgetInstance,
  GridElement,
  createWidgetInstance,
  serializeWidgetInstance,
  deserializeWidgetInstance,
  getSettings,
  getState,
  createErrorWidget,
} from './types';

export class WidgetInstanceGrid {
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

  public static fromWidgetInstances(widgetInstances: WidgetInstance[], options: { width?: number, height?: number | "auto", defaultElementWidth?: number, defaultElementHeight?: number } = {}) {
    const width = options.width ?? 24;
    const height = options.height ?? "auto";
    const elemWidth = options.defaultElementWidth ?? WidgetInstanceGrid.DEFAULT_ELEMENT_WIDTH;
    const elemHeight = options.defaultElementHeight ?? WidgetInstanceGrid.DEFAULT_ELEMENT_HEIGHT;

    const nonEmptyElements = widgetInstances
      .filter((instance) => !instance.widget.isHeightVariable)
      .map((instance, index) => ({
        instance,
        x: (index * elemWidth) % width,
        y: Math.floor(index / Math.floor(width / elemWidth)) * elemHeight,
        width: elemWidth,
        height: elemHeight,
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

    const afterJsonSerialization = JSON.parse(JSON.stringify(res));
    if (!deepPlainEquals(afterJsonSerialization, res)) {
      throw new StackAssertionError(`WidgetInstanceGrid serialization is not JSON-serializable!`, {
        beforeJsonSerialization: res,
        afterJsonSerialization,
      });
    }

    return res;
  }

  public static fromSerialized(widgets: Widget<any, any>[], serialized: Json): WidgetInstanceGrid {
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
      return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)) + 1;
    } else {
      return this._fixedHeight;
    }
  }

  private static _withEmptyElements(array: (WidgetInstance<any> | null)[][], varHeights: ReadonlyMap<number, WidgetInstance[]>, nonEmptyElements: GridElement[]) {
    let result: GridElement[] = [...nonEmptyElements];
    const newArray: (WidgetInstance<any> | null | "empty")[][] = array.map((row) => [...row]);
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
    if (element.instance?.widget.minWidth != null) {
      res.width = Math.max(res.width, element.instance.widget.minWidth);
    }
    if (element.instance?.widget.minHeight != null) {
      res.height = Math.max(res.height, element.instance.widget.minHeight);
    }
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

  private static _rectsOverlap(
    x1: number, y1: number, w1: number, h1: number,
    x2: number, y2: number, w2: number, h2: number,
  ): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  /**
   * Moves an element to a new position (keeping its original size).
   * Displaced elements are placed at the nearest available position,
   * preferring horizontal shifts on the same row before pushing down.
   */
  public withMovedElementTo(fromX: number, fromY: number, toX: number, toY: number): WidgetInstanceGrid {
    const element = this.getElementAt(fromX, fromY);
    if (!element.instance) return this;

    const newX = Math.max(0, Math.min(toX, this.width - element.width));
    const newY = Math.max(0, toY);

    if (newX === element.x && newY === element.y) return this;

    const movedElement: GridElement = { ...element, x: newX, y: newY };
    const otherElements = this._nonEmptyElements.filter(
      (e) => e.instance?.id !== element.instance?.id,
    );

    const sorted = [...otherElements].sort((a, b) => a.y - b.y || a.x - b.x);

    const placed: GridElement[] = [movedElement];
    for (const el of sorted) {
      const overlaps = placed.some((p) =>
        WidgetInstanceGrid._rectsOverlap(el.x, el.y, el.width, el.height, p.x, p.y, p.width, p.height),
      );

      if (!overlaps) {
        placed.push(el);
        continue;
      }

      const best = WidgetInstanceGrid._findNearestAvailablePosition(el, placed, this.width);
      placed.push({ ...el, x: best.x, y: best.y });
    }

    return new WidgetInstanceGrid(placed, this._varHeights, this.width, this._fixedHeight);
  }

  /**
   * Finds the nearest available (non-overlapping) position for an element,
   * preferring horizontal shifts on the same row before trying rows below.
   */
  private static _findNearestAvailablePosition(
    el: GridElement,
    placed: GridElement[],
    gridWidth: number,
  ): { x: number, y: number } {
    const fits = (tryX: number, tryY: number) => {
      if (tryX < 0 || tryX + el.width > gridWidth) return false;
      return placed.every(
        (p) => !WidgetInstanceGrid._rectsOverlap(tryX, tryY, el.width, el.height, p.x, p.y, p.width, p.height),
      );
    };

    // Scan expanding distances: same row first (horizontal), then rows below
    for (let dy = 0; dy < 50; dy++) {
      const tryY = el.y + dy;
      // At each row, try positions closest to the original x first
      for (let dx = 0; dx <= gridWidth; dx++) {
        if (fits(el.x + dx, tryY)) return { x: el.x + dx, y: tryY };
        if (dx !== 0 && fits(el.x - dx, tryY)) return { x: el.x - dx, y: tryY };
      }
    }

    // Absolute fallback: below everything
    const maxY = Math.max(0, ...placed.map((p) => p.y + p.height));
    return { x: el.x, y: maxY };
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

  /**
   * Resizes an element and pushes neighboring elements horizontally to make room.
   * When growing right, neighbors to the right are shrunk from their left edge.
   * When growing left, neighbors to the left are shrunk from their right edge.
   * Vertical resize uses normal clamping (no push).
   */
  public withResizedElementAndPush(
    x: number, y: number,
    requestedDelta: { top: number, left: number, bottom: number, right: number },
  ): { grid: WidgetInstanceGrid, achievedDelta: { top: number, left: number, bottom: number, right: number } } {
    const element = this.getElementAt(x, y);
    if (!element.instance) {
      return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 } };
    }

    const vertDelta = { top: requestedDelta.top, left: 0, bottom: requestedDelta.bottom, right: 0 };
    const clampedVert = this.clampElementResize(x, y, vertDelta);

    const array = this.as2dArray();
    let achievedRight = requestedDelta.right;
    let achievedLeft = requestedDelta.left;
    const neighborChanges = new Map<string, { x: number, width: number }>();

    if (achievedRight > 0) {
      achievedRight = Math.min(achievedRight, this.width - element.x - element.width);

      if (achievedRight > 0) {
        const blockerIds = new Set<string>();
        for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
          for (let col = element.x + element.width; col < element.x + element.width + achievedRight && col < this.width; col++) {
            const occ = array[col][row];
            if (occ && occ !== element.instance) blockerIds.add(occ.id);
          }
        }

        for (const id of blockerIds) {
          const blocker = this.getElementByInstanceId(id);
          if (!blocker?.instance) continue;

          const blockerMinWidth = this.elementMinSize(blocker).width;
          const maxShrink = blocker.width - blockerMinWidth;
          const maxGrowth = blocker.x - element.x - element.width + maxShrink;
          achievedRight = Math.min(achievedRight, Math.max(0, maxGrowth));
        }

        if (achievedRight > 0) {
          const newRightEdge = element.x + element.width + achievedRight;
          for (const id of blockerIds) {
            const blocker = this.getElementByInstanceId(id);
            if (!blocker?.instance) continue;
            const overlap = newRightEdge - blocker.x;
            if (overlap > 0) {
              neighborChanges.set(id, { x: blocker.x + overlap, width: blocker.width - overlap });
            }
          }
        }
      }
      achievedRight = Math.max(0, achievedRight);
    }

    if (achievedLeft < 0) {
      achievedLeft = Math.max(achievedLeft, -element.x);

      if (achievedLeft < 0) {
        const blockerIds = new Set<string>();
        for (let row = element.y; row < element.y + element.height && row < this.height; row++) {
          for (let col = element.x + achievedLeft; col < element.x && col >= 0; col++) {
            const occ = array[col][row];
            if (occ && occ !== element.instance) blockerIds.add(occ.id);
          }
        }

        for (const id of blockerIds) {
          const blocker = this.getElementByInstanceId(id);
          if (!blocker?.instance) continue;

          const blockerMinWidth = this.elementMinSize(blocker).width;
          const maxShrink = blocker.width - blockerMinWidth;
          const maxGrowth = (blocker.x + blocker.width) - element.x + maxShrink;
          achievedLeft = Math.max(achievedLeft, Math.min(0, -maxGrowth));
        }

        if (achievedLeft < 0) {
          const newLeftEdge = element.x + achievedLeft;
          for (const id of blockerIds) {
            const blocker = this.getElementByInstanceId(id);
            if (!blocker?.instance) continue;
            const overlap = (blocker.x + blocker.width) - newLeftEdge;
            if (overlap > 0) {
              neighborChanges.set(id, { x: blocker.x, width: blocker.width - overlap });
            }
          }
        }
      }
      achievedLeft = Math.min(0, achievedLeft);
    }

    const elementMinWidth = this.elementMinSize(element).width;
    const newWidth = element.width - achievedLeft + achievedRight;
    if (newWidth < elementMinWidth) {
      return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 } };
    }

    const achievedDelta = {
      top: clampedVert.top,
      left: achievedLeft,
      bottom: clampedVert.bottom,
      right: achievedRight,
    };

    if (achievedDelta.top === 0 && achievedDelta.left === 0 && achievedDelta.bottom === 0 && achievedDelta.right === 0) {
      return { grid: this, achievedDelta };
    }

    const newElements = this._nonEmptyElements.map(el => {
      if (el.instance?.id === element.instance?.id) {
        return {
          ...el,
          x: el.x + achievedDelta.left,
          y: el.y + achievedDelta.top,
          width: el.width - achievedDelta.left + achievedDelta.right,
          height: el.height - achievedDelta.top + achievedDelta.bottom,
        };
      }
      const change = neighborChanges.get(el.instance?.id ?? '');
      if (change) {
        return { ...el, x: change.x, width: change.width };
      }
      return el;
    });

    try {
      const newGrid = new WidgetInstanceGrid(newElements, this._varHeights, this.width, this._fixedHeight);
      return { grid: newGrid, achievedDelta };
    } catch {
      const clamped = this.clampElementResize(x, y, requestedDelta);
      if (clamped.top === 0 && clamped.left === 0 && clamped.bottom === 0 && clamped.right === 0) {
        return { grid: this, achievedDelta: clamped };
      }
      try {
        return { grid: this.withResizedElement(x, y, clamped), achievedDelta: clamped };
      } catch {
        return { grid: this, achievedDelta: { top: 0, left: 0, bottom: 0, right: 0 } };
      }
    }
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
    return this._withUpdatedElementInstance(x, y, () => null);
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
