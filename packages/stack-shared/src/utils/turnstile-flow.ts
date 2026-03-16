import { loadTurnstileScript, getTurnstileApi } from "./turnstile-browser";
import type { TurnstileAction, TurnstileRetryResult } from "./turnstile";

export class TurnstileUserCancelledError extends Error {
  constructor() {
    super("User cancelled the Turnstile challenge");
    this.name = "TurnstileUserCancelledError";
  }
}

export async function executeTurnstileInvisible(siteKey: string, action: TurnstileAction): Promise<string> {
  await loadTurnstileScript();
  const api = getTurnstileApi();
  if (!api) throw new Error("Turnstile API not available");

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  document.body.appendChild(container);

  let widgetId: string | undefined;

  try {
    const token = await new Promise<string>((resolve, reject) => {
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        size: "invisible",
        execution: "execute",
        appearance: "execute",
        callback: resolve,
        "error-callback": () => reject(new Error("Turnstile invisible verification failed")),
        "expired-callback": () => reject(new Error("Turnstile token expired")),
        "timeout-callback": () => reject(new Error("Turnstile challenge timed out")),
      });

      if (api.execute) {
        api.execute(widgetId);
      }
    });
    return token;
  } finally {
    if (widgetId != null) {
      try {
        api.remove(widgetId);
      } catch { /* ignore cleanup errors */ }
    }
    container.remove();
  }
}

const TURNSTILE_OVERLAY_Z_INDEX = "999999";

let activeOverlay: { cleanup: () => void, reject: (err: Error) => void } | null = null;

export function showTurnstileVisibleChallenge(siteKey: string, action: TurnstileAction): Promise<string> {
  if (activeOverlay) {
    activeOverlay.reject(new TurnstileUserCancelledError());
    activeOverlay.cleanup();
    activeOverlay = null;
  }

  return new Promise<string>((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-stack-turnstile-overlay", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: TURNSTILE_OVERLAY_Z_INDEX,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(2px)",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      background: "white",
      borderRadius: "12px",
      padding: "24px",
      maxWidth: "400px",
      width: "90%",
      textAlign: "center",
      boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });

    const title = document.createElement("p");
    title.textContent = "Please complete the security check";
    Object.assign(title.style, {
      margin: "0 0 16px",
      fontSize: "16px",
      fontWeight: "600",
      color: "#333",
    });
    card.appendChild(title);

    const widgetContainer = document.createElement("div");
    Object.assign(widgetContainer.style, {
      display: "flex",
      justifyContent: "center",
      minHeight: "65px",
    });
    card.appendChild(widgetContainer);

    const errorText = document.createElement("p");
    Object.assign(errorText.style, {
      margin: "8px 0 0",
      fontSize: "14px",
      color: "#dc2626",
      display: "none",
    });
    card.appendChild(errorText);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    Object.assign(cancelBtn.style, {
      marginTop: "16px",
      padding: "8px 20px",
      border: "1px solid #ddd",
      borderRadius: "6px",
      background: "transparent",
      cursor: "pointer",
      fontSize: "14px",
      color: "#666",
    });
    cancelBtn.onmouseover = () => {
      cancelBtn.style.background = "#f5f5f5";
    };
    cancelBtn.onmouseout = () => {
      cancelBtn.style.background = "transparent";
    };
    card.appendChild(cancelBtn);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function cleanup() {
      overlay.remove();
      if (activeOverlay?.cleanup === cleanup) {
        activeOverlay = null;
      }
    }

    activeOverlay = { cleanup, reject };

    cancelBtn.onclick = () => {
      cleanup();
      reject(new TurnstileUserCancelledError());
    };

    loadTurnstileScript().then(() => {
      const api = getTurnstileApi();
      if (!api) {
        cleanup();
        reject(new Error("Turnstile API not available"));
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

export type TurnstileExecuteParams = {
  token?: string,
  phase?: "invisible" | "visible",
  previousResult?: TurnstileRetryResult,
};

export type WithTurnstileFlowOptions<T> = {
  visibleSiteKey: string,
  invisibleSiteKey: string,
  action: TurnstileAction,
  execute: (turnstile: TurnstileExecuteParams) => Promise<T>,
  isChallengeRequired: (result: T) => TurnstileRetryResult | null,
};

export async function withTurnstileFlow<T>(options: WithTurnstileFlowOptions<T>): Promise<T> {
  // SSR safe: just call execute with no turnstile params
  if (typeof window === "undefined") {
    return await options.execute({});
  }

  // Phase 1: invisible token
  let invisibleToken: string | undefined;
  try {
    invisibleToken = await executeTurnstileInvisible(options.invisibleSiteKey, options.action);
  } catch {
    // If invisible execution fails, fall back to the visible challenge
    invisibleToken = await showTurnstileVisibleChallenge(options.visibleSiteKey, options.action);
  }

  const firstResult = await options.execute({
    token: invisibleToken,
    phase: invisibleToken ? "invisible" : undefined,
  });

  const challengeResult = options.isChallengeRequired(firstResult);
  if (challengeResult == null) {
    return firstResult;
  }

  // Phase 2: visible challenge overlay (single retry)
  const visibleToken = await showTurnstileVisibleChallenge(options.visibleSiteKey, options.action);

  return await options.execute({
    token: visibleToken,
    phase: "visible",
    previousResult: challengeResult,
  });
}
