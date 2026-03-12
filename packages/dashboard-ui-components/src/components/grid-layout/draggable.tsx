"use client";

import { useDraggable } from '@dnd-kit/core';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { filterUndefined } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { RefState } from '@stackframe/stack-shared/dist/utils/react';
import { cn, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, SimpleTooltip } from '@stackframe/stack-ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GridFour, X } from '@phosphor-icons/react';
import { DesignButton } from '../button';
import type { DesignButtonProps } from '../button';
import { WidgetInstance, getSettings } from './types';
import { ResizeHandle } from './resize-handle';
import { SwappableWidgetInstanceGridContext } from './grid';

class GridErrorBoundary extends React.Component<
  { children: React.ReactNode, fallback: (error: unknown, reset: (() => void) | undefined) => React.ReactNode },
  { error: unknown | null, hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null, hasError: false };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error, hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null, hasError: false }));
    }
    return this.props.children;
  }
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function BigIconButton({ icon, children, ...props }: { icon: React.ReactNode } & DesignButtonProps) {
  return (
    <DesignButton
      variant="outline"
      className={cn("h-20 w-20 p-1 rounded-full backdrop-blur-md bg-slate-200/20 dark:bg-black/20")}
      {...props}
    >
      {icon}
      {children}
    </DesignButton>
  );
}

export function Draggable(props: {
  type: 'element' | 'var-height',
  widgetInstance: WidgetInstance<any>,
  style?: React.CSSProperties,
  x: number,
  y: number,
  width: number,
  height: number,
  activeWidgetId: string | null,
  isEditing: boolean,
  selectingForEdit?: boolean,
  isSingleColumnMode: boolean,
  onDeleteWidget: () => Promise<void>,
  settings: any,
  setSettings: (settings: any) => Promise<void>,
  stateRef: RefState<any>,
  onResize: (edges: { top: number, left: number, bottom: number, right: number }, visualHeight?: number) => { top: number, left: number, bottom: number, right: number },
  calculateUnitSize: () => { width: number, height: number },
  resizeBlocked?: { top: boolean, left: boolean, right: boolean, bottom: boolean },
  isStatic: boolean,
  fitContent?: boolean,
}) {
  const [isSettingsOpen, setIsSettingsOpenRaw] = useState(false);
  const [unsavedSettings, setUnsavedSettings] = useState(props.settings);
  const [settingsClosingAnimationCounter, setSettingsClosingAnimationCounter] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isEditingSubGrid, setIsEditingSubGrid] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isEditing = props.isEditing && !isEditingSubGrid;
  const selectingForEdit = !!props.selectingForEdit;
  const showOverlay = isEditing;
  const showHoverOverlay = selectingForEdit && isHovered;
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

  const dragDisabled = !isEditing || props.isStatic;
  const { attributes, listeners, setNodeRef, transform, isDragging, node: draggableContainerRef } = useDraggable({
    id: props.widgetInstance.id,
    disabled: dragDisabled,
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.isEditing) {
      setIsEditingSubGrid(false);
    }
  }, [props.isEditing]);

  const isFixedHeight = !props.fitContent && !props.isSingleColumnMode && props.type === "element";
  const isCompact = props.height <= 3;

  useEffect(() => {
    let cancelled = false;
    if (isSettingsOpen) {
      if (!settingsOpenAnimationDetails) {
        runAsynchronouslyWithAlert(async () => {
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

  const triggerEdit = useCallback(() => {
    const settings = getSettings(props.widgetInstance);
    const widgetLabel = (settings && typeof settings === 'object' && 'text' in settings && typeof settings.text === 'string')
      ? settings.text
      : props.widgetInstance.widget.id;
    if (props.widgetInstance.widget.SettingsComponent) {
      setIsSettingsOpen(true);
    } else {
      window.dispatchEvent(new CustomEvent('widget-edit-request', {
        detail: { widgetId: props.widgetInstance.widget.id, widgetLabel },
      }));
    }
  }, [props.widgetInstance, setIsSettingsOpen]);

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
        onMouseEnter={() => { if (selectingForEdit) setIsHovered(true); }}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'relative',
          minWidth: '100%',
          minHeight: '100%',
          display: 'flex',
          transformOrigin: '0 0 0',
          zIndex: isDragging ? 100000 : 1,

          transition: [
            'border-width 0.1s ease',
            'box-shadow 0.1s ease',
            props.activeWidgetId !== props.widgetInstance.id && (props.activeWidgetId !== null) ? 'transform 0.2s ease, opacity 0.2s ease' : undefined,
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
            overflow: props.isStatic ? 'auto' : 'hidden',
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
              alignItems: "flex-start",
            }}
          >
            <div style={{ flexGrow: 1, minWidth: 0, width: "100%", height: "100%" }}>
              <SwappableWidgetInstanceGridContext.Provider value={{ isEditing: isEditingSubGrid }}>
                <GridErrorBoundary fallback={(error, reset) => (
                  <div className="text-red-500 text-sm p-2 bg-red-500/10 font-mono whitespace-pre-wrap">
                    A runtime error occured while rendering this widget.<br />
                    <br />
                    {reset && <button className="text-blue-500 hover:underline" onClick={() => {
                      reset();
                    }}>Reload widget</button>}<br />
                    <br />
                    {errorToString(error)}
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
                </GridErrorBoundary>
              </SwappableWidgetInstanceGridContext.Provider>
            </div>
          </div>
          <div
            {...{ inert: "" } as any}
            style={{
              position: 'absolute',
              inset: 0,
              opacity: (showOverlay || showHoverOverlay) ? 1 : 0,
              transition: 'opacity 0.2s ease',
              backgroundImage: !isDeleting ? 'radial-gradient(circle at top, #ffffff08, #ffffff02), radial-gradient(circle at top right,  #ffffff04, transparent, transparent)' : undefined,
              borderRadius: 'inherit',
              pointerEvents: 'none',
            }}
          />
          <div
            {...{ inert: "" } as any}
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: (showOverlay || showHoverOverlay) && !isDragging ? 'blur(3px)' : 'none',
              borderRadius: 'inherit',
              pointerEvents: 'none',
            }}
          />
          {selectingForEdit && (
            <div
              onClick={() => triggerEdit()}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 2,
                cursor: 'pointer',
              }}
            />
          )}
          {!isDragging && isEditing && !selectingForEdit && (
            <div
              style={{
                opacity: 1,
                pointerEvents: 'auto',
                transition: 'opacity 0.2s ease',
              }}
            >
              <div
                {...listeners}
                {...attributes}
                style={{
                  cursor: 'move',
                  position: 'absolute',
                  inset: 0,
                  touchAction: 'none',
                  zIndex: 1,
                }}
              />
              {props.widgetInstance.widget.hasSubGrid && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerEvents: 'none' }}>
                  <BigIconButton
                    icon={<GridFour size={isCompact ? 16 : 24} />}
                    loadingStyle="disabled"
                    style={{ pointerEvents: 'auto', ...(isCompact ? { height: 48, width: 48 } : {}) }}
                    onClick={async () => {
                      setIsEditingSubGrid(true);
                    }}
                  />
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  runAsynchronouslyWithAlert(async () => {
                    setIsDeleting(true);
                    setConfirmingDelete(false);
                    try {
                      await wait(300);
                      await props.onDeleteWidget();
                    } catch (err) {
                      setIsDeleting(false);
                      throw err;
                    }
                  });
                }}
                onMouseLeave={() => setConfirmingDelete(false)}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  zIndex: 101,
                  width: confirmingDelete ? 'auto' : 20,
                  height: 20,
                  padding: confirmingDelete ? '0 6px' : undefined,
                  borderRadius: confirmingDelete ? '10px' : '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  background: confirmingDelete ? '#ef4444' : 'rgba(0,0,0,0.5)',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {confirmingDelete ? <>
                  <X size={10} weight="bold" />
                  Delete?
                </> : <X size={12} weight="bold" />}
              </button>
              {!props.isStatic && [-1, 0, 1].flatMap(x => [-1, 0, 1].map(y => (x !== 0 || y !== 0) && (
                <ResizeHandle
                  key={`${x},${y}`}
                  widgetInstance={props.widgetInstance}
                  x={x}
                  y={y}
                  onResize={(edges) => props.onResize(edges, draggableContainerRef.current?.getBoundingClientRect().height)}
                  calculateUnitSize={props.calculateUnitSize}
                />
              )))}
              {props.resizeBlocked?.top && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    backgroundColor: '#ef4444',
                    borderRadius: '8px 8px 0 0',
                    pointerEvents: 'none',
                    zIndex: 101,
                  }}
                />
              )}
              {props.resizeBlocked?.right && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: 3,
                    backgroundColor: '#ef4444',
                    borderRadius: '0 8px 8px 0',
                    pointerEvents: 'none',
                    zIndex: 101,
                  }}
                />
              )}
              {props.resizeBlocked?.left && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: 3,
                    backgroundColor: '#ef4444',
                    borderRadius: '8px 0 0 8px',
                    pointerEvents: 'none',
                    zIndex: 101,
                  }}
                />
              )}
              {props.resizeBlocked?.bottom && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    backgroundColor: '#ef4444',
                    borderRadius: '0 0 8px 8px',
                    pointerEvents: 'none',
                    zIndex: 101,
                  }}
                />
              )}
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
            {...(isSettingsOpen ? {} : { inert: "" }) as any}
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
              <DesignButton
                variant="secondary"
                onClick={async () => {
                  setIsSettingsOpen(false);
                }}
              >
                Cancel
              </DesignButton>
              <DesignButton
                variant="default"
                onClick={async () => {
                  await props.setSettings(unsavedSettings);
                  setIsSettingsOpen(false);
                }}
              >
                Save
              </DesignButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
