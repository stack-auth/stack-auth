'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MockCursor } from './mock-cursor';
import { type SpotlightRect, type WalkthroughStep } from './walkthrough-steps';

export function WalkthroughOverlay({
  step,
  stepIndex,
  totalSteps,
  spotlightRect,
  cursorPosition,
  showSpotlight,
  isHovering,
  onStop,
}: {
  step: WalkthroughStep | null,
  stepIndex: number,
  totalSteps: number,
  spotlightRect: SpotlightRect | null,
  cursorPosition: { x: number, y: number },
  showSpotlight: boolean,
  isHovering: boolean,
  onStop: () => void,
}) {
  // Track whether the spotlight has animated in from full-screen to target
  const [animatedIn, setAnimatedIn] = useState(false);

  // When showSpotlight turns on or stepIndex changes, reset to full-screen and then animate in
  useEffect(() => {
    if (!showSpotlight) {
      setAnimatedIn(false);
      return;
    }
    // Start at full viewport, then on next frame animate to target
    setAnimatedIn(false);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setAnimatedIn(true);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [showSpotlight, stepIndex]);

  if (typeof document === 'undefined') return null;

  // When not yet animated in, spotlight covers the full viewport (no visible cutout)
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
      {/* Walkthrough layer — spotlight, tooltip (z-40, below CmdK) */}
      <div className="fixed inset-0 z-40 pointer-events-none">
        {/* Spotlight cutout overlay */}
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
                transition: 'top 0.6s cubic-bezier(0.4, 0, 0.2, 1), left 0.6s cubic-bezier(0.4, 0, 0.2, 1), width 0.6s cubic-bezier(0.4, 0, 0.2, 1), height 0.6s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                borderRadius: animatedIn ? undefined : '0px',
              }}
            />

            {animatedIn && (
              <SpotlightTooltip
                step={step}
                stepIndex={stepIndex}
                totalSteps={totalSteps}
                spotlightRect={spotlightRect!}
              />
            )}
          </>
        )}
      </div>

      {/* Mock mouse cursor — own stacking context above CmdK (z-[55]) */}
      <div
        className="fixed top-0 left-0 pointer-events-none z-[55]"
        style={{
          transform: `translate(${cursorPosition.x}px, ${cursorPosition.y}px)`,
          transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <MockCursor />
      </div>

      {/* "Click to take control" hover overlay — above everything including CmdK */}
      {isHovering && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStop();
          }}
        >
          <p className="text-white text-2xl font-semibold">Click to take control</p>
        </div>
      )}

      {/* Invisible click catcher — catches clicks when not hovering (z-40, below CmdK) */}
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

function SpotlightTooltip({
  step,
  stepIndex,
  totalSteps,
  spotlightRect,
}: {
  step: WalkthroughStep,
  stepIndex: number,
  totalSteps: number,
  spotlightRect: SpotlightRect,
}) {
  const tooltipWidth = 280;
  const tooltipHeight = 90;
  const tooltipGap = 16;
  const viewportMargin = 16;
  const padding = step.spotlightPadding ?? 8;

  const spotlightTop = spotlightRect.top - padding;
  const spotlightBottom = spotlightRect.top + spotlightRect.height + padding;
  const spotlightCenterX = spotlightRect.left + spotlightRect.width / 2;

  // Default: below the spotlight
  let top = spotlightBottom + tooltipGap;
  let left = spotlightCenterX - tooltipWidth / 2;

  // If tooltip would go off-screen bottom, position above
  if (top + tooltipHeight > window.innerHeight - viewportMargin) {
    top = spotlightTop - tooltipGap - tooltipHeight;
  }

  // Clamp to viewport
  top = Math.max(viewportMargin, Math.min(top, window.innerHeight - tooltipHeight - viewportMargin));
  left = Math.max(viewportMargin, Math.min(left, window.innerWidth - tooltipWidth - viewportMargin));

  return (
    <div
      className={cn(
        "fixed pointer-events-none p-4 rounded-xl",
        "bg-white shadow-xl ring-1 ring-black/10",
      )}
      style={{
        top,
        left,
        width: tooltipWidth,
        transition: 'top 0.4s ease, left 0.4s ease',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-gray-900">{step.title}</span>
        <span className="text-xs text-gray-400">{stepIndex + 1} / {totalSteps}</span>
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
    </div>
  );
}
