// IF_PLATFORM js-like

import type { StackClientApp } from "../lib/stack-app";
import { isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";
import { createDevTool } from "./dev-tool-core";

const OVERRIDE_KEY = '__stack-dev-tool-override';

function hasAppendChild(value: unknown): value is { appendChild(node: Node): void } {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'appendChild') === 'function';
}

function canMountIntoDom(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  if (typeof document.createElement !== 'function') {
    return false;
  }
  return hasAppendChild(Reflect.get(document, 'body'));
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
  if (!canMountIntoDom()) return false;
  return isLocalhost(window.location.href);
}

let activeCleanup: (() => void) | null = null;
let activeApp: StackClientApp<true> | null = null;

function tryMount() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }

  if (!shouldShow() || !activeApp || !canMountIntoDom()) return;

  const app = activeApp;
  activeCleanup = createDevTool(app);
}

/**
 * Mounts the Stack Auth dev tool on the page.
 *
 * - Only renders on localhost (or when overridden via console)
 * - Lazily loads the dev tool UI via dynamic import
 * - Returns a cleanup function to unmount
 *
 * Console commands (also work in production):
 *   StackDevTool.enable()  — force-show the dev tool
 *   StackDevTool.disable() — force-hide the dev tool
 *   StackDevTool.reset()   — revert to default (localhost-only)
 */
export function mountDevTool(app: StackClientApp<true>): () => void {
  activeApp = app;
  tryMount();

  return () => {
    activeApp = null;
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }
  };
}

// Expose console commands: StackDevTool.enable() / .disable() / .reset()
if (typeof window !== 'undefined') {
  (window as any).StackDevTool = {
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
