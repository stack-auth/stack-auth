import { StackAssertionError, captureError } from "./errors";
import { loadTurnstileScript, getTurnstileApi } from "./turnstile-browser";
import type { TurnstileAction } from "./turnstile";

export class BotChallengeUserCancelledError extends Error {
  constructor() {
    super("User cancelled the bot challenge");
    this.name = "BotChallengeUserCancelledError";
  }
}

export class BotChallengeExecutionFailedError extends Error {
  constructor(message = "Bot challenge could not be completed", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BotChallengeExecutionFailedError";
  }
}


// ── Invisible challenge ────────────────────────────────────────────────

const INVISIBLE_TIMEOUT_MS = 30_000;

export async function executeTurnstileInvisible(siteKey: string, action: TurnstileAction): Promise<string> {
  await loadTurnstileScript();
  const api = getTurnstileApi();
  if (!api) throw new StackAssertionError("Turnstile API not available after loadTurnstileScript() resolved");

  const container = document.createElement("div");
  Object.assign(container.style, { position: "fixed", left: "-9999px", top: "-9999px" });
  document.body.appendChild(container);

  let widgetId: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Turnstile invisible challenge timed out")),
        INVISIBLE_TIMEOUT_MS,
      );
      const settle = (fn: () => void) => {
        clearTimeout(timeout);
        fn();
      };

      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        size: "invisible",
        execution: "execute",
        appearance: "execute",
        callback: (t) => settle(() => resolve(t)),
        "error-callback": () => settle(() => reject(new Error("Turnstile invisible verification failed"))),
        "expired-callback": () => settle(() => reject(new Error("Turnstile token expired"))),
        "timeout-callback": () => settle(() => reject(new Error("Turnstile challenge timed out"))),
      });

      api.execute?.(widgetId);
    });
  } finally {
    if (widgetId != null) {
      try {
        api.remove(widgetId);
      } catch (e) {
        captureError("turnstile-widget-remove", e instanceof Error ? e : new StackAssertionError("Non-Error thrown during Turnstile widget removal", { cause: e }));
      }
    }
    container.remove();
  }
}


// ── Visible challenge overlay ──────────────────────────────────────────

const VISIBLE_TIMEOUT_MS = 120_000;
const OVERLAY_Z_INDEX = "999999";

// Module-level singleton: only one visible overlay can be active at a time.
// If a second challenge is requested while one is showing (e.g. user clicks another
// auth flow), the previous overlay is cancelled with BotChallengeUserCancelledError
// and cleaned up before the new one renders.
let activeOverlay: { cleanup: () => void, reject: (err: Error) => void } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
  props?: Record<string, string>,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.assign(element.style, style);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      element.setAttribute(k, v);
    }
  }
  return element;
}

export function showTurnstileVisibleChallenge(siteKey: string, action: TurnstileAction): Promise<string> {
  if (activeOverlay) {
    activeOverlay.reject(new BotChallengeUserCancelledError());
    activeOverlay.cleanup();
    activeOverlay = null;
  }

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Visible Turnstile challenge timed out"));
    }, VISIBLE_TIMEOUT_MS);

    const overlay = el("div", {
      position: "fixed", inset: "0", zIndex: OVERLAY_Z_INDEX,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
    }, { "data-stack-turnstile-overlay": "true" });

    const card = el("div", {
      background: "white", borderRadius: "12px", padding: "24px",
      maxWidth: "400px", width: "90%", textAlign: "center",
      boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });

    const title = el("p", { margin: "0 0 16px", fontSize: "16px", fontWeight: "600", color: "#333" });
    title.textContent = "Please complete the security check";

    const widgetContainer = el("div", { display: "flex", justifyContent: "center", minHeight: "65px" });

    const errorText = el("p", { margin: "8px 0 0", fontSize: "14px", color: "#dc2626", display: "none" });

    const cancelBtn = el("button", {
      marginTop: "16px", padding: "8px 20px", border: "1px solid #ddd",
      borderRadius: "6px", background: "transparent", cursor: "pointer",
      fontSize: "14px", color: "#666",
    });
    cancelBtn.textContent = "Cancel";
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = "#f5f5f5";
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = "transparent";
    };

    card.append(title, widgetContainer, errorText, cancelBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function cleanup() {
      clearTimeout(timeout);
      overlay.remove();
      if (activeOverlay?.cleanup === cleanup) {
        activeOverlay = null;
      }
    }

    activeOverlay = { cleanup, reject };
    cancelBtn.onclick = () => {
      cleanup();
      reject(new BotChallengeUserCancelledError());
    };

    loadTurnstileScript().then(() => {
      const api = getTurnstileApi();
      if (!api) {
        cleanup();
        reject(new StackAssertionError("Turnstile API not available after loadTurnstileScript() resolved"));
        return;
      }

      api.render(widgetContainer, {
        sitekey: siteKey,
        action,
        appearance: "always",
        execution: "render",
        size: "flexible",
        callback: (token) => {
          cleanup();
          resolve(token);
        },
        "error-callback": (errorCode) => {
          errorText.textContent = errorCode ? `Verification error: ${errorCode}` : "Verification failed. Please try again.";
          errorText.style.display = "block";
        },
        "expired-callback": () => {
          errorText.textContent = "Challenge expired. Please solve it again.";
          errorText.style.display = "block";
        },
      });
    }).catch((err) => {
      cleanup();
      reject(err);
    });
  });
}


// ── Flow orchestrator ──────────────────────────────────────────────────

export type BotChallengeExecuteParams = {
  token?: string,
  phase?: "invisible" | "visible",
  unavailable?: true,
};

export type WithBotChallengeFlowOptions<T> = {
  visibleSiteKey: string,
  invisibleSiteKey: string,
  action: TurnstileAction,
  execute: (challenge: BotChallengeExecuteParams) => Promise<T>,
  isChallengeRequired: (result: T) => boolean,
};

// We use separate invisible + visible flows (rather than Turnstile's "managed" mode) because:
// 1. Managed mode auto-decides visibility, but we need deterministic server-side logic:
//    invisible-fail → require visible challenge → fail = block.
// 2. Invisible + visible use different site keys so the server can tell which phase passed.
// 3. Managed mode doesn't expose an API to programmatically trigger a retry with a
//    different widget type, which our two-phase challenge escalation requires.
export async function withBotChallengeFlow<T>(options: WithBotChallengeFlowOptions<T>): Promise<T> {
  // Server safe: no Turnstile in SSR — just call execute with no turnstile params
  if (typeof window === "undefined") {
    return await options.execute({});
  }

  // Phase 1: invisible token
  let invisibleToken: string | undefined;
  let usedVisibleFallback = false;
  try {
    invisibleToken = await executeTurnstileInvisible(options.invisibleSiteKey, options.action);
  } catch {
    try {
      invisibleToken = await showTurnstileVisibleChallenge(options.visibleSiteKey, options.action);
      usedVisibleFallback = true;
    } catch (e) {
      if (e instanceof BotChallengeUserCancelledError) throw e;
      // Both challenges failed (for example Cloudflare is unreachable) — tell the
      // server explicitly so it can distinguish challenge infra outages from a
      // user submitting an invalid visible challenge.
      captureError("turnstile-flow-all-challenges-failed", e instanceof Error ? e : new StackAssertionError("Non-Error thrown during Turnstile challenge", { cause: e }));
      return await options.execute({ unavailable: true });
    }
  }

  const firstResult = await options.execute({
    token: invisibleToken,
    phase: invisibleToken ? (usedVisibleFallback ? "visible" : "invisible") : undefined,
  });

  if (!options.isChallengeRequired(firstResult)) {
    return firstResult;
  }

  // Phase 2: visible challenge (single retry)
  let visibleToken: string | undefined;
  try {
    visibleToken = await showTurnstileVisibleChallenge(options.visibleSiteKey, options.action);
  } catch (e) {
    if (e instanceof BotChallengeUserCancelledError) throw e;
    captureError("turnstile-flow-visible-challenge-failed", e instanceof Error ? e : new StackAssertionError("Non-Error thrown during visible Turnstile challenge", { cause: e }));
    throw new BotChallengeExecutionFailedError("Visible bot challenge could not be completed", {
      cause: e,
    });
  }

  return await options.execute({ token: visibleToken, phase: "visible" });
}
