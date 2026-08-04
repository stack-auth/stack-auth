'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MockCursor } from './mock-cursor';
import { type SpotlightRect, type WalkthroughPhase, type WalkthroughStep } from './walkthrough-steps';

export type { WalkthroughPhase };

const SPOTLIGHT_BORDER = 'rgb(59 130 246)'; // blue-500

export function WalkthroughOverlay({
  step,
  stepIndex,
  totalSteps,
  spotlightRect,
  cursorPosition,
  showSpotlight,
  phase,
  isHovering,
  dwellMs,
  onStop,
}: {
  step: WalkthroughStep | null,
  stepIndex: number,
  totalSteps: number,
  spotlightRect: SpotlightRect | null,
  cursorPosition: { x: number, y: number },
  showSpotlight: boolean,
  phase: WalkthroughPhase,
  isHovering: boolean,
  dwellMs: number,
  onStop: () => void,
}) {
  const [animatedIn, setAnimatedIn] = useState(false);

  useEffect(() => {
    if (!showSpotlight) {
      setAnimatedIn(false);
      return;
    }
    setAnimatedIn(false);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setAnimatedIn(true);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [showSpotlight, stepIndex]);

  if (typeof document === 'undefined') return null;

  const fullViewport = {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };

  const displayRect = showSpotlight && spotlightRect
    ? (animatedIn ? spotlightRect : fullViewport)
    : null;

  const padding = step?.spotlightPadding ?? 8;
  const overlayOpacity = showSpotlight ? (animatedIn ? 0.62 : 0) : 0;

  return createPortal(
    <>
      {/* Spotlight layer (below CmdK at z-40) */}
      <div className="fixed inset-0 z-40 pointer-events-none">
        {showSpotlight && displayRect && step && (
          <>
            <div
              className="fixed pointer-events-none"
              style={{
                top: displayRect.top - padding,
                left: displayRect.left - padding,
                width: displayRect.width + padding * 2,
                height: displayRect.height + padding * 2,
                borderRadius: animatedIn ? '14px' : '0px',
                border: animatedIn ? `2px solid ${SPOTLIGHT_BORDER}` : '0px solid transparent',
                boxShadow: animatedIn
                  ? `0 0 0 9999px rgba(0, 0, 0, ${overlayOpacity}), 0 0 14px 2px rgba(59, 130, 246, 0.35), 0 0 28px 6px rgba(59, 130, 246, 0.12)`
                  : `0 0 0 9999px rgba(0, 0, 0, ${overlayOpacity})`,
                transition: 'all 400ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />

            {animatedIn && (
              <SpotlightTooltip
                step={step}
                stepIndex={stepIndex}
                totalSteps={totalSteps}
                phase={phase}
                spotlightRect={spotlightRect!}
                padding={padding}
              />
            )}
          </>
        )}
      </div>

      {/* Mock cursor — above CmdK */}
      <div
        className="fixed top-0 left-0 pointer-events-none z-[55]"
        style={{
          transform: `translate(${cursorPosition.x}px, ${cursorPosition.y}px)`,
          transition: 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <MockCursor phase={phase} />
      </div>

      {step && (
        <TourProgressCard
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          phase={phase}
          dwellMs={dwellMs}
        />
      )}

      {/* "Click to take control" hover overlay */}
      <div
        className={cn(
          "fixed inset-0 z-[60] flex items-center justify-center cursor-pointer",
          "bg-black/50 backdrop-blur-[2px]",
          "transition-opacity duration-150",
          isHovering ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onStop();
        }}
      >
        <p className="text-white text-2xl font-semibold drop-shadow-lg">
          Click to take control
        </p>
      </div>

      {/* Invisible click catcher (active only when not hovering) */}
      {!isHovering && (
        <div
          className="fixed inset-0 z-40"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStop();
          }}
        />
      )}
    </>,
    document.body
  );
}

function TourProgressCard({
  stepIndex,
  totalSteps,
  phase,
  dwellMs,
}: {
  stepIndex: number,
  totalSteps: number,
  phase: WalkthroughPhase,
  dwellMs: number,
}) {
  const [progress, setProgress] = useState(stepIndex / totalSteps);
  const [transitionMs, setTransitionMs] = useState(0);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;

    if (phase === 'finishing') {
      setTransitionMs(300);
      setProgress(1);
    } else if (phase === 'dwelling') {
      setTransitionMs(0);
      setProgress(stepIndex / totalSteps);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setTransitionMs(dwellMs);
          setProgress((stepIndex + 1) / totalSteps);
        });
      });
    } else {
      setTransitionMs(250);
      setProgress(stepIndex / totalSteps);
    }

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [phase, stepIndex, totalSteps, dwellMs]);

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-[57]",
        "pointer-events-none select-none",
        "w-[min(720px,calc(100vw-32px))]",
      )}
    >
      <div
        className={cn(
          "rounded-2xl overflow-hidden",
          "bg-white/95 dark:bg-zinc-900/90",
          "backdrop-blur-2xl",
          "ring-1 ring-black/10 dark:ring-white/10",
          "shadow-2xl shadow-black/40",
        )}
      >
        <div className="px-5 pt-3.5 pb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full",
                "text-[10px] font-bold uppercase tracking-wider",
                "bg-blue-500 text-white",
              )}
            >
              Tour
            </span>
            <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200 tabular-nums">
              Step {stepIndex + 1} of {totalSteps}
            </span>
            {phase === 'navigating' && (
              <span className="text-[12px] text-zinc-500 dark:text-zinc-400 italic">
                · navigating…
              </span>
            )}
          </div>
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
            {Math.round(progress * 100)}%
          </span>
        </div>

        <div className="px-5 pb-4">
          <div
            className={cn(
              "relative h-3 rounded-full overflow-hidden",
              "bg-zinc-200/80 dark:bg-white/10",
              "ring-1 ring-inset ring-black/5 dark:ring-white/5",
            )}
          >
            <div
              className="absolute inset-y-0 left-0 origin-left rounded-full bg-blue-500"
              style={{
                width: '100%',
                transform: `scaleX(${progress})`,
                transition: transitionMs > 0
                  ? `transform ${transitionMs}ms linear`
                  : 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SpotlightTooltip({
  step,
  stepIndex,
  totalSteps,
  phase,
  spotlightRect,
  padding,
}: {
  step: WalkthroughStep,
  stepIndex: number,
  totalSteps: number,
  phase: WalkthroughPhase,
  spotlightRect: SpotlightRect,
  padding: number,
}) {
  const tooltipWidth = 280;
  const tooltipGap = 14;
  const viewportMarginTop = 16;
  const viewportMarginBottom = 112;
  const viewportMarginX = 16;

  const spotlightTop = spotlightRect.top - padding;
  const spotlightBottom = spotlightRect.top + spotlightRect.height + padding;
  const spotlightCenterX = spotlightRect.left + spotlightRect.width / 2;

  let placement: 'below' | 'above' = 'below';
  let top = spotlightBottom + tooltipGap;

  const estimatedHeight = 96;
  if (top + estimatedHeight > window.innerHeight - viewportMarginBottom) {
    placement = 'above';
    top = spotlightTop - tooltipGap - estimatedHeight;
  }

  top = Math.max(
    viewportMarginTop,
    Math.min(top, window.innerHeight - estimatedHeight - viewportMarginBottom),
  );

  let left = spotlightCenterX - tooltipWidth / 2;
  left = Math.max(
    viewportMarginX,
    Math.min(left, window.innerWidth - tooltipWidth - viewportMarginX),
  );

  const pointerLeft = Math.max(
    20,
    Math.min(spotlightCenterX - left, tooltipWidth - 20),
  );

  return (
    <div
      className="fixed pointer-events-none"
      style={{
        top,
        left,
        width: tooltipWidth,
        transition: 'top 400ms cubic-bezier(0.22, 1, 0.36, 1), left 400ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Speech bubble pointer */}
      <div
        className={cn(
          "absolute w-3 h-3",
          "bg-white/95 dark:bg-zinc-900/90",
          "border-black/10 dark:border-white/10",
        )}
        style={{
          left: pointerLeft - 6,
          ...(placement === 'below'
            ? {
              top: -6,
              borderTopWidth: '1px',
              borderLeftWidth: '1px',
              transform: 'rotate(45deg)',
            }
            : {
              bottom: -6,
              borderBottomWidth: '1px',
              borderRightWidth: '1px',
              transform: 'rotate(45deg)',
            }),
        }}
      />

      <div
        className={cn(
          "relative rounded-xl px-4 py-3",
          "bg-white/95 dark:bg-zinc-900/90",
          "backdrop-blur-xl",
          "shadow-2xl shadow-black/25",
          "ring-1 ring-black/10 dark:ring-white/10",
        )}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{step.title}</span>
          <span className="text-[11px] tabular-nums font-medium text-zinc-500 dark:text-zinc-400">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{step.description}</p>
        {phase === 'navigating' && (
          <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500 italic">navigating…</p>
        )}
      </div>
    </div>
  );
}

