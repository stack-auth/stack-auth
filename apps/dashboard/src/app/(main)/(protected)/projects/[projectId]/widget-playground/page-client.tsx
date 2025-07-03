"use client";

import { DndContext, pointerWithin, useDraggable, useDroppable } from '@dnd-kit/core';
import { range } from '@stackframe/stack-shared/dist/utils/arrays';
import { StackAssertionError, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { Button, ButtonProps, Card, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, cn } from '@stackframe/stack-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaPen, FaPlus, FaTrash } from 'react-icons/fa';
import { PageLayout } from "../page-layout";

type Widget<Settings> = {
  mainComponent: React.ComponentType<{ settings: Settings }>,
  settingsComponent: React.ComponentType<{ settings: Settings, onUpdateSettings: (settings: Settings) => void }>,
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
  private static readonly _defaultInstanceWidth = 6;
  private static readonly _defaultInstanceHeight = 4;

  private constructor(
    private readonly _nonEmptyElements: GridElement[],
    public readonly width: number,
  ) {}

  public static fromWidgetInstances(widgetInstances: WidgetInstance<any>[]) {
    const width = 12;

    const nonEmptyElements = widgetInstances.map((instance, index) => ({
      instance,
      x: (index * WidgetInstanceGrid._defaultInstanceWidth) % width,
      y: Math.floor(index / Math.floor(width / WidgetInstanceGrid._defaultInstanceWidth)) * WidgetInstanceGrid._defaultInstanceHeight,
      width: WidgetInstanceGrid._defaultInstanceWidth,
      height: WidgetInstanceGrid._defaultInstanceHeight,
    }));

    return new WidgetInstanceGrid(
      nonEmptyElements,
      width,
    );
  }

  public get height(): number {
    return Math.max(0, ...[...this._nonEmptyElements].map(({ y, height }) => y + height)) + WidgetInstanceGrid._defaultInstanceHeight;
  }

  private static _withEmptyElements(array: (WidgetInstance<any> | null)[][], nonEmptyElements: GridElement[]) {
    let result: GridElement[] = [...nonEmptyElements];
    const newArray: (WidgetInstance<any> | null | "empty")[][] = array.map((row, y) => [...row]);
    for (let x1 = 0; x1 < array.length; x1++) {
      for (let y1 = 0; y1 < array[x1].length; y1++) {
        if (newArray[x1][y1] === null) {
          let x2 = x1 + 1;
          while (x2 < array.length && x2 - x1 < WidgetInstanceGrid._defaultInstanceWidth) {
            if (newArray[x2][y1] !== null) {
              break;
            }
            x2++;
          }
          let y2 = y1 + 1;
          outer: while (y2 < array[x1].length && y2 - y1 < WidgetInstanceGrid._defaultInstanceHeight) {
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
      <SwappableWidgetInstanceGrid grid={widgetGrid} setGrid={setWidgetGrid} isEditing={isAltDown} />
    </PageLayout>
  );
}

function SwappableWidgetInstanceGrid(props: { grid: WidgetInstanceGrid, setGrid: (grid: WidgetInstanceGrid) => void, isEditing: boolean }) {
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
      collisionDetection={pointerWithin}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${grid.width}, 1fr)`,
        gridTemplateRows: `repeat(${grid.height}, 1fr)`,
        gap: '32px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}>
        {range(grid.height).map((y) => (
          <div key={y} style={{ height: '64px', gridColumn: `1 / ${grid.width + 1}`, gridRow: `${y + 1} / ${y + 2}` }} />
        ))}
        {[...grid].map(({ instance, x, y, width, height }) => {
          const isHoverSwap = hoverSwap && instance && (hoverSwap[0] === instance.id);
          return (
            <Droppable
              key={instance?.id ?? JSON.stringify({ x, y, width, height })}
              isEmpty={!instance}
              x={x}
              y={y}
              width={width}
              height={height}
              grid={grid}
            >
              {instance && (
                <Draggable
                  widgetInstance={instance}
                  shouldTransition={activeWidgetId !== instance.id && (activeWidgetId !== null)}
                  isEditing={props.isEditing}
                  style={{
                    transform: isHoverSwap ? `translate(${-hoverSwap[1][0]}px, ${-hoverSwap[1][1]}px)` : undefined,
                  }}
                  onDelete={async () => {
                    throw new StackAssertionError("Widget delete currently not implemented");
                  }}
                  settings={instance.settings}
                  onSaveSettings={async (settings) => {
                    throw new StackAssertionError("Widget save settings currently not implemented");
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

function Droppable(props: { children: React.ReactNode, style?: React.CSSProperties, x: number, y: number, width: number, height: number, isEmpty: boolean, grid: WidgetInstanceGrid }) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: JSON.stringify([props.x, props.y]),
  });

  const shouldRenderAddWidget = props.isEmpty && props.width >= props.grid.width / 4 && props.height >= 3;

  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'relative',
        display: 'flex',
        backgroundColor: isOver ? '#88888822' : undefined,
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
            animation: 'stack-animation-fade-in 600ms 50ms ease forwards',
            opacity: 0,
          }}
        >
          <BigIconButton icon={<FaPlus size={24} opacity={0.7} />} onClick={() => {
            throw new StackAssertionError("Add widget currently not implemented");
          }} />
        </div>
      </>)}
      {props.children}
    </div>
  );
}

function Draggable(props: { widgetInstance: WidgetInstance<any>, style: React.CSSProperties, shouldTransition: boolean, isEditing: boolean, onDelete: () => Promise<void>, settings: any, onSaveSettings: (settings: any) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
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

  const draggableContainerRef = useRef<HTMLDivElement>(null);
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
  }, [isSettingsOpen, settingsOpenAnimationDetails]);

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
        /* note: Chrome and Safari have inconsistent behavior where backfacevisibility and/or transform-style is not inherited by children, so we ensure it works with the style tag above + transformStyle */
        .stack-recursive-backface-hidden {
          backface-visibility: hidden;
          ${isSafari ? '' : 'transform-style: preserve-3d;'}
        }
        .stack-recursive-backface-hidden * {
          backface-visibility: hidden;
        }
      `}</style>
      <div
        ref={draggableContainerRef}
        className="stack-recursive-backface-hidden"
        style={{
          position: 'relative',
          flexGrow: 1,
          alignSelf: 'stretch',
          display: 'flex',

          zIndex: isDragging ? 100000 : undefined,

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
          ref={setNodeRef}
          className={cn(isDragging && 'bg-white dark:bg-black border-black/20 dark:border-white/20')}
          style={{
            position: 'relative',
            flexGrow: 1,
            alignSelf: 'stretch',
            boxShadow: props.isEditing ? '0 0 32px 0 #8882' : '0 0 0 0 transparent',
            cursor: isDragging ? 'grabbing' : (props.isEditing ? 'move' : 'default'),
            transition: [
              'border-width 0.1s ease',
              'box-shadow 0.1s ease',
              !props.shouldTransition ? undefined : 'transform 0.4s ease',
            ].filter(Boolean).join(', '),
            borderRadius: '8px',
            borderWidth: props.isEditing && !isDragging ? '1px' : '0px',
            borderStyle: 'solid',
            ...props.style,
            transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) ${props.style.transform ?? ''}`,
          }}
        >
          <div
            style={{
            }}
          >
            <props.widgetInstance.widget.mainComponent settings={props.widgetInstance.settings} />
          </div>
          <div
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
                    position: 'absolute',
                    inset: 0,
                  }}
                />
                <BigIconButton icon={<FaPen size={24} />} onClick={async () => {
                  setIsSettingsOpen(true);
                }} />
                <BigIconButton
                  icon={<FaTrash size={24} />}
                  loadingStyle="disabled"
                  onClick={async () => {
                    setIsDeleting(true);
                    try {
                      await wait(1000);
                      await props.onDelete();
                    } catch (e) {
                      // in case something went wrong with the delete, we want to reset the state
                      setIsDeleting(false);
                      throw e;
                    }
                  }}
                />
              </div>
              <ResizeHandle widgetInstance={props.widgetInstance} x={-1} y={-1} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={-1} y={0} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={-1} y={1} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={0} y={-1} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={0} y={1} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={1} y={-1} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={1} y={0} />
              <ResizeHandle widgetInstance={props.widgetInstance} x={1} y={1} />
            </div>
          )}
        </div>
      </div>
      <Dialog open={isSettingsOpen || settingsClosingAnimationCounter > 0} onOpenChange={setIsSettingsOpen}>
        <DialogContent
          ref={dialogRef}
          overlayProps={{
            style: {
              opacity: settingsOpenAnimationDetails?.shouldStart && !settingsOpenAnimationDetails.revert ? 1 : 0,
              transition: 'opacity 0.6s ease',
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
            <props.widgetInstance.widget.settingsComponent settings={unsavedSettings} onUpdateSettings={setUnsavedSettings} />
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

function ResizeHandle(props: { widgetInstance: WidgetInstance<any>, x: number, y: number }) {
  if (Math.sign(props.x) !== props.x || Math.sign(props.y) !== props.y) {
    throw new StackAssertionError(`Invalid resize handle coordinates, must be -1, 0, or 1: ${props.x}, ${props.y}`);
  }

  const isCorner = props.x !== 0 && props.y !== 0;

  return (
    <div
      className="border-black dark:border-white"
      style={{
        position: 'absolute',
        zIndex: 100000,

        left: props.x === -1 ? '-3px' : props.x === 0 ? '50%' : undefined,
        top: props.y === -1 ? '-3px' : props.y === 0 ? '50%' : undefined,
        right: props.x === 1 ? '-3px' : undefined,
        bottom: props.y === 1 ? '-3px' : undefined,
        transform: `translate(${props.x === 0 ? '-50%' : 0}, ${props.y === 0 ? '-50%' : 0})`,

        width: '36px',
        height: '36px',

        opacity: 0.8,

        borderWidth: '6px',
        borderTopStyle: props.y === -1 ? 'solid' : 'none',
        borderRightStyle: props.x === 1 ? 'solid' : 'none',
        borderBottomStyle: props.y === 1 ? 'solid' : 'none',
        borderLeftStyle: props.x === -1 ? 'solid' : 'none',
        borderTopLeftRadius: props.x === -1 && props.y === -1 ? '16px' : undefined,
        borderTopRightRadius: props.x === 1 && props.y === -1 ? '16px' : undefined,
        borderBottomLeftRadius: props.x === -1 && props.y === 1 ? '16px' : undefined,
        borderBottomRightRadius: props.x === 1 && props.y === 1 ? '16px' : undefined,

        cursor: isCorner ? (props.x === props.y ? 'nwse-resize' : 'nesw-resize') : (props.x === 0 ? 'ns-resize' : 'ew-resize'),
      }}
    ></div>
  );
}
