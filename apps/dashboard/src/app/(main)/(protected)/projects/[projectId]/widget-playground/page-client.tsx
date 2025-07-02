"use client";

import { DndContext, closestCenter, useDraggable, useDroppable } from '@dnd-kit/core';
import { range } from '@stackframe/stack-shared/dist/utils/arrays';
import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { Card } from '@stackframe/stack-ui';
import { useState } from 'react';
import { PageLayout } from "../page-layout";

type Widget<Settings> = {
  mainComponent: React.ComponentType<{ settings: Settings }>,
  settingsComponent: React.ComponentType<{ settings: Settings, onUpdateSettings: (settings: Settings) => void }>,
  defaultSettings: Settings,
};

type WidgetInstance<Settings> = {
  id: string,
  widget: Widget<Settings>,
  settings: Settings,
};

type GridElement = {
  instance: WidgetInstance<any> | null,
  x: number,
  y: number,
  width: number,
  height: number,
};

class WidgetInstanceGrid {
  private constructor(
    private readonly _nonEmptyElements: GridElement[],
    public readonly width: number,
  ) {}

  public static fromWidgetInstances(widgetInstances: WidgetInstance<any>[]) {
    const width = 12;
    const defaultInstanceWidth = 6;
    const defaultInstanceHeight = 4;

    const nonEmptyElements = widgetInstances.map((instance, index) => ({
      instance,
      x: (index * defaultInstanceWidth) % width,
      y: Math.floor(index / Math.floor(width / defaultInstanceWidth)) * defaultInstanceHeight,
      width: defaultInstanceWidth,
      height: defaultInstanceHeight,
    }));

    return new WidgetInstanceGrid(
      nonEmptyElements,
      width,
    );
  }

  public get height(): number {
    return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height));
  }

  private static _withEmptyElements(array: (WidgetInstance<any> | null)[][], nonEmptyElements: GridElement[]) {
    let result: GridElement[] = [...nonEmptyElements];
    const newArray: (WidgetInstance<any> | null | "empty")[][] = array.map((row, y) => [...row]);
    for (let x1 = 0; x1 < array.length; x1++) {
      for (let y1 = 0; y1 < array[x1].length; y1++) {
        if (newArray[x1][y1] === null) {
          let x2 = x1 + 1;
          while (x2 < array.length) {
            if (newArray[x2][y1] !== null) {
              break;
            }
            x2++;
          }
          let y2 = y1 + 1;
          outer: while (y2 < array[x1].length) {
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

  public withSwapped(x1: number, y1: number, x2: number, y2: number) {
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
}

const widgetInstances = [
  {
    id: 'abc',
    widget: {
      mainComponent: () => <Card>Widget 1</Card>,
      settingsComponent: () => <div>Settings 1</div>,
      defaultSettings: {},
    },
    settings: {},
  },
  {
    id: 'def',
    widget: {
      mainComponent: () => <Card>Widget 2</Card>,
      settingsComponent: () => <div>Settings 2</div>,
      defaultSettings: {},
    },
    settings: {},
  },
  {
    id: 'ghi',
    widget: {
      mainComponent: () => <Card>Widget 3</Card>,
      settingsComponent: () => <div>Settings 3</div>,
      defaultSettings: {},
    },
    settings: {},
  },
];

export default function PageClient() {
  const [widgetGrid, setWidgetGrid] = useState(WidgetInstanceGrid.fromWidgetInstances(widgetInstances));

  return (
    <PageLayout
      title="Widget Playground"
      fillWidth
    >
      <SwappableWidgetInstanceGrid grid={widgetGrid} setGrid={setWidgetGrid} />
    </PageLayout>
  );
}

function SwappableWidgetInstanceGrid(props: { grid: WidgetInstanceGrid, setGrid: (grid: WidgetInstanceGrid) => void }) {
  const [hoverSwap, setHoverSwap] = useState<[string, [number, number]] | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const grid = props.grid;

  return (
    <DndContext
      onDragStart={(event) => {
        setActiveWidgetId(event.active.id as string);
      }}
      onDragEnd={(event) => {
        setHoverSwap(null);
        setActiveWidgetId(null);

        const widgetId = event.active.id;
        const widgetElement = [...grid].find(({ instance }) => instance?.id === widgetId);
        if (!widgetElement) {
          throw new StackAssertionError(`Widget instance ${widgetId} not found in grid`);
        }
        if (event.over) {
          const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
          const newGrid = grid.withSwapped(widgetElement.x, widgetElement.y, overCoordinates[0], overCoordinates[1]);
          props.setGrid(newGrid);
        }
      }}
      onDragOver={(event) => {
        if (event.over) {
          if (!event.active.rect.current.initial) {
            // not sure when this happens, if ever. let's ignore it in prod, throw in dev
            if (process.env.NODE_ENV === 'development') {
              throw new StackAssertionError("Active element has no initial rect. Not sure when this happens, so please report it");
            }
          } else {
            const overCoordinates = JSON.parse(`${event.over.id}`) as [number, number];
            const overId = props.grid.getElementAt(overCoordinates[0], overCoordinates[1]).instance?.id;
            if (overId) {
              setHoverSwap([overId, [event.over.rect.left - event.active.rect.current.initial.left, event.over.rect.top - event.active.rect.current.initial.top]]);
            } else {
              setHoverSwap(null);
            }
          }
        } else {
          setHoverSwap(null);
        }
      }}
      collisionDetection={closestCenter}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${grid.width}, 1fr)`,
        gridTemplateRows: `repeat(${grid.height}, 1fr)`,
        gap: '12px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}>
        {range(grid.height).map((y) => (
          <div key={y} style={{ height: '96px', gridColumn: `1 / ${grid.width + 1}`, gridRow: `${y + 1} / ${y + 2}` }} />
        ))}
        {[...grid].map(({ instance, x, y, width, height }) => {
          const isHoverSwap = hoverSwap && instance && (hoverSwap[0] === instance.id);
          console.log(instance?.id, isHoverSwap, hoverSwap);
          return (
            <Droppable
              key={instance?.id ?? JSON.stringify({ x, y, width, height })}
              droppableId={JSON.stringify([x, y])}
              style={{
                gridColumn: `${x + 1} / span ${width}`,
                gridRow: `${y + 1} / span ${height}`,
                display: 'flex',
              }}>
              {instance && (
                <Draggable
                  widgetInstance={instance}
                  shouldTransition={activeWidgetId !== instance.id && (activeWidgetId !== null)}
                  style={{
                    transform: isHoverSwap ? `translate(${-hoverSwap[1][0]}px, ${-hoverSwap[1][1]}px)` : undefined,
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

function Droppable(props: { children: React.ReactNode, style: React.CSSProperties, droppableId: string }) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: props.droppableId,
  });


  return (
    <div
      ref={setNodeRef}
      style={{
        backgroundColor: isOver ? '#88888822' : undefined,
        borderRadius: '8px',
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

function Draggable(props: { widgetInstance: WidgetInstance<any>, style: React.CSSProperties, shouldTransition: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.widgetInstance.id,
  });


  return (
    <div
      ref={setNodeRef}
      style={{
        flexGrow: 1,
        alignSelf: 'stretch',
        transition: !props.shouldTransition ? undefined : 'transform 0.4s ease',
        ...props.style,
        transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) ${props.style.transform ?? ''}`,
      }}
      {...listeners}
      {...attributes}
    >
      <props.widgetInstance.widget.mainComponent settings={props.widgetInstance.settings} />
    </div>
  );
}
