// IF_PLATFORM js-like

import type { StackClientApp } from "../lib/hexclave-app";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { canMountIntoDom } from "../in-page-ui/dom";
import type { createDevTool as CreateDevToolFn } from "./dev-tool-core";

// Hexclave rebrand: UI-only local pref — straight rename (one-time reset is harmless)
const OVERRIDE_KEY = '__hexclave-dev-tool-override';

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
  if (!canMountIntoDom()) return false;
  return isLocalhost(window.location.href);
}

let activeCleanup: (() => void) | null = null;
let activeApp: StackClientApp<true> | null = null;
let mountGeneration = 0;

let createDevToolPromise: Promise<typeof CreateDevToolFn> | null = null;
function loadCreateDevTool(): Promise<typeof CreateDevToolFn> {
  if (!createDevToolPromise) {
    createDevToolPromise = import("./dev-tool-core").then(m => m.createDevTool).catch((err) => {
      createDevToolPromise = null;
      throw err;
    });
  }
  return createDevToolPromise;
}

function tryMount() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  if (!shouldShow() || !activeApp || !canMountIntoDom()) return;

  const generation = ++mountGeneration;
  const app = activeApp;

  runAsynchronously(async () => {
    const createDevTool = await loadCreateDevTool();
    if (generation !== mountGeneration) return;
    if (!shouldShow() || activeApp !== app || !canMountIntoDom()) return;
    activeCleanup = createDevTool(app);
  }, {
    noErrorLogging: true,
    onError: (error) => {
      captureError("dev-tool-mount", error);
    },
  });
}

/**
 * Mounts the Hexclave dev tool on the page.
 *
 * - Only renders on localhost (or when overridden via console)
 * - Lazily loads the dev tool UI via dynamic import
 * - Returns a cleanup function to unmount
 *
 * Console commands (also work in production):
 *   HexclaveDevTool.enable()  — force-show the dev tool
 *   HexclaveDevTool.disable() — force-hide the dev tool
 *   HexclaveDevTool.reset()   — revert to default (localhost-only)
 */
export function mountDevTool(app: StackClientApp<true>): () => void {
  activeApp = app;
  tryMount();

  // Capture the cleanup created by THIS specific mount call so that React
  // StrictMode's double-invoke doesn't let the first effect's cleanup tear
  // down the second mount (which would cause the tool to disappear silently).
  const myCleanup = activeCleanup;

  return () => {
    activeApp = null;
    if (activeCleanup === myCleanup && myCleanup != null) {
      activeCleanup = null;
      myCleanup();
    }
  };
}

// Expose console commands: HexclaveDevTool.enable() / .disable() / .reset()
if (typeof window !== 'undefined') {
  // Hexclave rebrand: expose under both the legacy and new global names.
  (window as any).HexclaveDevTool = (window as any).HexclaveDevTool = {
    enable() {
      try {
        localStorage.setItem(OVERRIDE_KEY, 'true');
      } catch {}
      tryMount();
      console.log('[Stack DevTool] Enabled. Refresh if the panel does not appear.');
    },
    disable() {
      try {
        localStorage.setItem(OVERRIDE_KEY, 'false');
      } catch {}
      if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
      }
      console.log('[Stack DevTool] Disabled.');
    },
    reset() {
      try {
        localStorage.removeItem(OVERRIDE_KEY);
      } catch {}
      if (shouldShow()) {
        tryMount();
      } else if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
      }
      console.log('[Stack DevTool] Reset to default (visible on localhost only).');
    },
  };
}

// END_PLATFORM
