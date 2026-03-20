"use client";

import React, { lazy, Suspense } from "react";

// IF_PLATFORM react-like

const DevToolIndicatorLazy = lazy(() =>
  import("./dev-tool-indicator").then((mod) => ({ default: mod.DevToolIndicator }))
);

/**
 * Dev Tool Indicator entry point.
 * - Only renders in development mode (process.env.NODE_ENV === 'development')
 * - Uses React.lazy + Suspense for zero production bundle impact
 * - Renders as a floating overlay pill in bottom-right corner
 */
export function DevToolEntry() {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <DevToolIndicatorLazy />
    </Suspense>
  );
}

// END_PLATFORM
