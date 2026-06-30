// IF_PLATFORM js-like

import {
  CLICKMAP_OVERLAY_RESUME_STORAGE_KEY,
  CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT,
} from "@hexclave/shared/dist/utils/analytics-clickmap-overlay";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { canMountIntoDom } from "../in-page-ui/dom";
import type { StackClientApp } from "../lib/hexclave-app";
import type { openClickmapOverlay as OpenClickmapOverlayFn } from "./clickmap-core";

// While the overlay is open it drops a sentinel into sessionStorage on unload
// (see clickmap-core); consuming it here reopens the clickmap on the next page
// so the user picks up where they left off.
function consumeResumeSentinel(): boolean {
  try {
    if (sessionStorage.getItem(CLICKMAP_OVERLAY_RESUME_STORAGE_KEY) !== '1') return false;
    sessionStorage.removeItem(CLICKMAP_OVERLAY_RESUME_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

let activeApp: StackClientApp<true> | null = null;
let activeOverlayCleanup: (() => void) | null = null;
let openGeneration = 0;
let tokenListenerAttached = false;

let openClickmapOverlayPromise: Promise<typeof OpenClickmapOverlayFn> | null = null;
function loadOpenClickmapOverlay(): Promise<typeof OpenClickmapOverlayFn> {
  if (!openClickmapOverlayPromise) {
    openClickmapOverlayPromise = import("./clickmap-core").then(m => m.openClickmapOverlay).catch((err) => {
      openClickmapOverlayPromise = null;
      throw err;
    });
  }
  return openClickmapOverlayPromise;
}

function tryOpenOverlay() {
  // Already open: the panel listens for the token event itself and refetches.
  if (activeOverlayCleanup || !activeApp || !canMountIntoDom()) return;

  const generation = ++openGeneration;
  const app = activeApp;

  runAsynchronously(async () => {
    const openClickmapOverlay = await loadOpenClickmapOverlay();
    if (generation !== openGeneration) return;
    if (activeOverlayCleanup || activeApp !== app || !canMountIntoDom()) return;
    activeOverlayCleanup = openClickmapOverlay(app, () => {
      activeOverlayCleanup = null;
    });
  }, {
    noErrorLogging: true,
    onError: (error) => {
      captureError("clickmap-mount", error);
    },
  });
}

/**
 * Mounts the clickmap overlay listener on the page.
 *
 * The clickmap is fully independent from the dev tool. It has no ambient UI:
 * nothing renders until a dashboard-minted token is handed over (the
 * CLICKMAP_OVERLAY_TOKEN_UPDATED event fired by the dashboard's console
 * snippet) or a navigation-resume sentinel is present — only then is the
 * actual overlay code lazily loaded and shown.
 */
export function mountClickmapOverlay(app: StackClientApp<true>): () => void {
  activeApp = app;

  if (typeof window !== 'undefined' && !tokenListenerAttached) {
    tokenListenerAttached = true;
    window.addEventListener(CLICKMAP_OVERLAY_TOKEN_UPDATED_EVENT, tryOpenOverlay);
  }

  if (canMountIntoDom() && consumeResumeSentinel()) {
    tryOpenOverlay();
  }

  return () => {
    if (activeApp !== app) return;
    activeApp = null;
    openGeneration++;
    activeOverlayCleanup?.();
  };
}

// END_PLATFORM
