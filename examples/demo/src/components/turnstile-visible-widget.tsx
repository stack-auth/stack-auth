'use client';

import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { useEffect, useRef } from "react";

type TurnstileWidgetId = string;

type TurnstileTheme = "auto" | "light" | "dark";
type TurnstileSize = "normal" | "flexible" | "compact";
type TurnstileAppearance = "always" | "execute" | "interaction-only";
type TurnstileExecution = "render" | "execute";

type TurnstileConfig = {
  sitekey: string,
  action: TurnstileAction,
  theme?: TurnstileTheme,
  size?: TurnstileSize,
  appearance?: TurnstileAppearance,
  execution?: TurnstileExecution,
  callback: (token: string) => void,
  "error-callback": (errorCode?: string) => void,
  "expired-callback": () => void,
  "timeout-callback": () => void,
};

type TurnstileApi = {
  render: (container: HTMLElement, config: TurnstileConfig) => TurnstileWidgetId,
  remove: (widgetId: TurnstileWidgetId) => void,
};

function isTurnstileApi(value: unknown): value is TurnstileApi {
  return typeof value === "object"
    && value !== null
    && "render" in value
    && "remove" in value;
}

function getTurnstileApi(): TurnstileApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const maybeTurnstile = Reflect.get(window, "turnstile");
  return isTurnstileApi(maybeTurnstile) ? maybeTurnstile : undefined;
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new StackAssertionError("Turnstile can only be loaded in the browser"));
  }

  if (getTurnstileApi()) {
    return Promise.resolve();
  }

  turnstileScriptPromise ??= new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Turnstile")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Turnstile"));
    document.head.append(script);
  });

  return turnstileScriptPromise;
}

export function TurnstileVisibleWidget(props: {
  siteKey: string,
  action: TurnstileAction,
  onTokenChange: (token: string | null) => void,
  onError?: (message: string) => void,
}) {
  const { action, onError, onTokenChange, siteKey } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);

  useEffect(() => {
    onTokenChange(null);

    const container = containerRef.current;
    if (container == null) {
      return;
    }

    const state = {
      cancelled: false,
    };

    void (async () => {
      await loadTurnstileScript();
      const turnstileApi = getTurnstileApi();
      if (state.cancelled || !turnstileApi) {
        return;
      }

      widgetIdRef.current = turnstileApi.render(container, {
        sitekey: siteKey,
        action,
        appearance: "always",
        execution: "render",
        theme: "auto",
        size: "flexible",
        callback: (token) => {
          onTokenChange(token);
        },
        "error-callback": (errorCode) => {
          onTokenChange(null);
          onError?.(errorCode ? `Turnstile error: ${errorCode}` : "Turnstile verification failed");
        },
        "expired-callback": () => {
          onTokenChange(null);
          onError?.("Turnstile token expired. Solve the challenge again.");
        },
        "timeout-callback": () => {
          onTokenChange(null);
          onError?.("Turnstile challenge timed out. Solve it again.");
        },
      });
    })().catch((error: unknown) => {
      onTokenChange(null);
      onError?.(error instanceof Error ? error.message : "Failed to load Turnstile");
    });

    return () => {
      state.cancelled = true;
      onTokenChange(null);
      const turnstileApi = getTurnstileApi();
      if (widgetIdRef.current != null && turnstileApi) {
        turnstileApi.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, onError, onTokenChange, siteKey]);

  return <div ref={containerRef} className="w-full min-h-16" />;
}
