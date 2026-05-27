'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MockCursor } from './mock-cursor';
import { type SpotlightRect, type WalkthroughStep } from './walkthrough-steps';

export type WalkthroughPhase = 'navigating' | 'dwelling' | 'finishing';

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
  const overlayOpacity = showSpotlight ? (animatedIn ? 0.55 : 0) : 0;

  return createPortal(
    <>
      {/* Spotlight layer (below CmdK at z-40) */}
      <div className="fixed inset-0 z-40 pointer-events-none">
        {showSpotlight && displayRect && step && (
          <>
            <div
              className="fixed pointer-events-none rounded-xl"
              style={{
                top: displayRect.top - padding,
                left: displayRect.left - padding,
                width: displayRect.width + padding * 2,
                height: displayRect.height + padding * 2,
                boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${overlayOpacity})`,
                transition: 'all 400ms cubic-bezier(0.22, 1, 0.36, 1)',
                borderRadius: animatedIn ? undefined : '0px',
              }}
            />

            {animatedIn && (
              <SpotlightTooltip
                step={step}
                stepIndex={stepIndex}
                totalSteps={totalSteps}
                phase={phase}
                spotlightRect={spotlightRect!}
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
        <MockCursor />
      </div>

      {/* Floating tour progress card — bottom-center, bold and unmissable */}
      {step && (
        <TourProgressCard
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          phase={phase}
          dwellMs={dwellMs}
        />
      )}

      {/* "Click to take control" hover overlay — above everything including CmdK */}
      <div
        className={cn(
          "fixed inset-0 z-[60] flex items-center justify-center cursor-pointer",
          "bg-black/50 backdrop-blur-[2px]",
          "transition-opacity duration-200",
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

      {/* Invisible click catcher (active only when not hovering) — anywhere = stop */}
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
  // Animate the bar's scaleX. During 'dwelling', grow from i/N to (i+1)/N over
  // `dwellMs`. During 'navigating', hold at i/N. During 'finishing', show 100%.
  const [progress, setProgress] = useState(stepIndex / totalSteps);
  const [transitionMs, setTransitionMs] = useState(0);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;

    if (phase === 'finishing') {
      setTransitionMs(300);
      setProgress(1);
    } else if (phase === 'dwelling') {
      // Snap to start with no transition, then next frame kick off the long animation.
      setTransitionMs(0);
      setProgress(stepIndex / totalSteps);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setTransitionMs(dwellMs);
          setProgress((stepIndex + 1) / totalSteps);
        });
      });
    } else {
      // 'navigating' — hold at start of step with a short transition so loop
      // resets ease in rather than snap.
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
                "bg-gradient-to-r from-blue-500 to-indigo-500 text-white",
                "shadow-[0_0_12px_rgba(59,130,246,0.6)]",
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

        {/* The big bar */}
        <div className="px-5 pb-4">
          <div
            className={cn(
              "relative h-3 rounded-full overflow-hidden",
              "bg-zinc-200/80 dark:bg-white/10",
              "ring-1 ring-inset ring-black/5 dark:ring-white/5",
            )}
          >
            <div
              className={cn(
                "absolute inset-y-0 left-0 origin-left rounded-full",
                "bg-gradient-to-r from-blue-500 via-blue-500 to-indigo-500",
                "shadow-[0_0_18px_rgba(59,130,246,0.85),0_0_6px_rgba(99,102,241,1)]",
              )}
              style={{
                width: '100%',
                transform: `scaleX(${progress})`,
                transition: transitionMs > 0
                  ? `transform ${transitionMs}ms linear`
                  : 'none',
              }}
            >
              {/* Bright leading edge highlight */}
              <div
                className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-white/80 to-transparent pointer-events-none"
              />
            </div>
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
}: {
  step: WalkthroughStep,
  stepIndex: number,
  totalSteps: number,
  phase: WalkthroughPhase,
  spotlightRect: SpotlightRect,
}) {
  const tooltipWidth = 300;
  const tooltipHeight = 96;
  const tooltipGap = 16;
  // Reserve room for the bottom progress card (~88px tall including margin).
  const viewportMarginTop = 16;
  const viewportMarginBottom = 112;
  const viewportMarginX = 16;
  const padding = step.spotlightPadding ?? 8;

  const spotlightTop = spotlightRect.top - padding;
  const spotlightBottom = spotlightRect.top + spotlightRect.height + padding;
  const spotlightCenterX = spotlightRect.left + spotlightRect.width / 2;

  // Default: below the spotlight.
  let top = spotlightBottom + tooltipGap;
  let left = spotlightCenterX - tooltipWidth / 2;

  // If that would collide with the bottom progress card, flip to above the spotlight.
  if (top + tooltipHeight > window.innerHeight - viewportMarginBottom) {
    top = spotlightTop - tooltipGap - tooltipHeight;
  }

  top = Math.max(
    viewportMarginTop,
    Math.min(top, window.innerHeight - tooltipHeight - viewportMarginBottom),
  );
  left = Math.max(
    viewportMarginX,
    Math.min(left, window.innerWidth - tooltipWidth - viewportMarginX),
  );

  return (
    <div
      className={cn(
        "fixed pointer-events-none px-4 py-3 rounded-xl",
        "bg-white/95 dark:bg-zinc-900/90",
        "backdrop-blur-xl",
        "shadow-2xl shadow-black/25",
        "ring-1 ring-black/10 dark:ring-white/10",
      )}
      style={{
        top,
        left,
        width: tooltipWidth,
        transition: 'top 400ms cubic-bezier(0.22, 1, 0.36, 1), left 400ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
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
  );
}
