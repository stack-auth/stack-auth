"use client";

import React, { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";

// IF_PLATFORM react-like

const DevToolIndicatorLazy = lazy(() =>
  import("./dev-tool-indicator").then((mod) => ({ default: mod.DevToolIndicator }))
);

const OVERRIDE_KEY = '__stack-dev-tool-override';

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function getOverride(): boolean | null {
  try {
    const val = localStorage.getItem(OVERRIDE_KEY);
    if (val === 'true') return true;
    if (val === 'false') return false;
  } catch {}
  return null;
}

function shouldShow(): boolean {
  const override = getOverride();
  if (override !== null) return override;
  return isLocalhost();
}

// External store for console toggle — lets React re-render when the flag changes
let listeners = new Set<() => void>();
let snapshot = typeof window !== 'undefined' ? shouldShow() : false;

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot() {
  return snapshot;
}
function getServerSnapshot() {
  return false;
}

function notify() {
  snapshot = shouldShow();
  for (const cb of listeners) cb();
}

// Expose console commands: StackDevTool.enable() / StackDevTool.disable() / StackDevTool.reset()
if (typeof window !== 'undefined') {
  // Cast: attaching a runtime-only debugging API to the global scope
  (window as any).StackDevTool = {
    enable() {
      try {
        localStorage.setItem(OVERRIDE_KEY, 'true');
      } catch {
        // localStorage may be unavailable (private browsing, quota exceeded)
      }
      notify();
      console.log('[Stack DevTool] Enabled. Refresh if the panel does not appear.');
    },
    disable() {
      try {
        localStorage.setItem(OVERRIDE_KEY, 'false');
      } catch {
        // localStorage may be unavailable
      }
      notify();
      console.log('[Stack DevTool] Disabled.');
    },
    reset() {
      try {
        localStorage.removeItem(OVERRIDE_KEY);
      } catch {
        // localStorage may be unavailable
      }
      notify();
      console.log('[Stack DevTool] Reset to default (visible on localhost only).');
    },
  };
}

/**
 * Dev Tool Indicator entry point.
 * - Only renders when origin is localhost (or override is set via console)
 * - Uses React.lazy + Suspense for code-split loading
 * - Renders as a floating overlay pill in bottom-right corner
 *
 * Console commands (works in production):
 *   StackDevTool.enable()  — force-show the dev tool
 *   StackDevTool.disable() — force-hide the dev tool
 *   StackDevTool.reset()   — revert to default (localhost-only)
 */
export function DevToolEntry() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!visible) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <DevToolIndicatorLazy />
    </Suspense>
  );
}

// END_PLATFORM
