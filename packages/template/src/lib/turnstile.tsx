import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React, { useEffect, useRef } from "react";
import { StackClientApp, stackAppInternalsSymbol } from "./stack-app";

type TurnstileWidgetId = string;
const developmentVisibleTurnstileSiteKey = "1x00000000000000000000AA";
const developmentInvisibleTurnstileSiteKey = "1x00000000000000000000BB";
type TurnstileAppearance = "always" | "interaction-only";
type TurnstileExecution = "render" | "execute";
type TurnstileSize = "invisible" | "flexible" | "normal" | "compact";

type TurnstileConfig = {
  sitekey: string,
  action: TurnstileAction,
  appearance?: TurnstileAppearance,
  execution?: TurnstileExecution,
  size?: TurnstileSize,
  callback: (token: string) => void,
  "error-callback": () => void,
  "expired-callback": () => void,
  "timeout-callback"?: () => void,
};

type TurnstileApi = {
  render: (container: HTMLElement, config: TurnstileConfig) => TurnstileWidgetId,
  execute: (widgetId: TurnstileWidgetId) => void,
  remove: (widgetId: TurnstileWidgetId) => void,
  reset?: (widgetId: TurnstileWidgetId) => void,
};

function isTurnstileApi(value: unknown): value is TurnstileApi {
  return typeof value === "object"
    && value !== null
    && "render" in value
    && "execute" in value
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

function isDevelopmentLikeEnvironment() {
  return process.env.NODE_ENV !== "production";
}

export function getTurnstileSiteKey(app: StackClientApp): string {
  const configuredSiteKey = app[stackAppInternalsSymbol].getConstructorOptions().fraudProtection?.turnstileSiteKey
    ?? process.env.NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY;
  if (configuredSiteKey != null) {
    return configuredSiteKey;
  }
  if (isDevelopmentLikeEnvironment()) {
    return developmentVisibleTurnstileSiteKey;
  }
  return throwErr("Turnstile site key is not configured");
}

export function getTurnstileInvisibleSiteKey(app: StackClientApp): string {
  return app[stackAppInternalsSymbol].getConstructorOptions().fraudProtection?.turnstileInvisibleSiteKey
    ?? process.env.NEXT_PUBLIC_STACK_TURNSTILE_INVISIBLE_SITE_KEY
    ?? (isDevelopmentLikeEnvironment() ? developmentInvisibleTurnstileSiteKey : getTurnstileSiteKey(app));
}

export function useTurnstile(options: {
  siteKey: string,
  action: TurnstileAction,
  appearance?: TurnstileAppearance,
  execution?: TurnstileExecution,
  size?: TurnstileSize,
  enabled?: boolean,
  onTokenChange?: (token: string | null) => void,
  onError?: (message: string) => void,
}) {
  const siteKey = options.siteKey;
  const isEnabled = options.enabled ?? true;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const widgetReadyRef = useRef<Promise<void> | null>(null);
  const onTokenChangeRef = useRef(options.onTokenChange);
  const onErrorRef = useRef(options.onError);
  const pendingPromiseRef = useRef<{
    resolve: (token: string) => void,
    reject: (error: Error) => void,
    promise: Promise<string>,
  } | null>(null);

  useEffect(() => {
    onTokenChangeRef.current = options.onTokenChange;
    onErrorRef.current = options.onError;
  }, [options.onError, options.onTokenChange]);

  function onTokenChange(token: string | null) {
    onTokenChangeRef.current?.(token);
  }

  function onError(message: string) {
    onErrorRef.current?.(message);
  }

  useEffect(() => {
    if (!isEnabled || !containerRef.current) {
      widgetReadyRef.current = null;
      onTokenChange(null);
      return;
    }

    const state = {
      cancelled: false,
    };
    const container = containerRef.current;
    widgetReadyRef.current = (async () => {
      await loadTurnstileScript();
      const turnstileApi = getTurnstileApi();

      if (state.cancelled || !turnstileApi) {
        return;
      }

      widgetIdRef.current = turnstileApi.render(container, {
        sitekey: siteKey,
        action: options.action,
        appearance: options.appearance,
        execution: options.execution,
        size: options.size,
        callback: (token) => {
          pendingPromiseRef.current?.resolve(token);
          pendingPromiseRef.current = null;
          onTokenChange(token);
        },
        "error-callback": () => {
          pendingPromiseRef.current?.reject(new Error("Turnstile verification failed"));
          pendingPromiseRef.current = null;
          onTokenChange(null);
          onError("Turnstile verification failed. Try again.");
        },
        "expired-callback": () => {
          pendingPromiseRef.current?.reject(new Error("Turnstile token expired"));
          pendingPromiseRef.current = null;
          onTokenChange(null);
          onError("Turnstile token expired. Solve the challenge again.");
        },
        "timeout-callback": () => {
          pendingPromiseRef.current?.reject(new Error("Turnstile challenge timed out"));
          pendingPromiseRef.current = null;
          onTokenChange(null);
          onError("Turnstile challenge timed out. Solve it again.");
        },
      });
    })();

    return () => {
      state.cancelled = true;
      pendingPromiseRef.current?.reject(new Error("Turnstile widget was unmounted"));
      pendingPromiseRef.current = null;
      onTokenChange(null);

      const turnstileApi = getTurnstileApi();
      if (widgetIdRef.current && turnstileApi) {
        turnstileApi.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [isEnabled, options.action, options.appearance, options.execution, options.size, siteKey]);

  async function executeTurnstile(): Promise<string> {
    if (!widgetReadyRef.current) {
      throw new StackAssertionError("Turnstile widget was not initialized");
    }

    await widgetReadyRef.current;

    const widgetId = widgetIdRef.current;
    const turnstileApi = getTurnstileApi();
    if (!widgetId || !turnstileApi) {
      throw new StackAssertionError("Turnstile widget is not available");
    }

    if (pendingPromiseRef.current) {
      return await pendingPromiseRef.current.promise;
    }

    let resolvePromise: ((token: string) => void) | undefined;
    let rejectPromise: ((error: Error) => void) | undefined;
    const promise = new Promise<string>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    if (!resolvePromise || !rejectPromise) {
      throw new StackAssertionError("Turnstile promise handlers were not initialized");
    }
    pendingPromiseRef.current = {
      resolve: resolvePromise,
      reject: rejectPromise,
      promise,
    };

    turnstileApi.execute(widgetId);
    return await promise;
  }

  function resetTurnstile() {
    const widgetId = widgetIdRef.current;
    const turnstileApi = getTurnstileApi();
    if (widgetId == null || !turnstileApi?.reset) {
      return;
    }
    pendingPromiseRef.current?.reject(new Error("Turnstile widget was reset"));
    pendingPromiseRef.current = null;
    onTokenChange(null);
    turnstileApi.reset(widgetId);
  }

  return {
    executeTurnstile,
    resetTurnstile,
    turnstileWidget: <div ref={containerRef} className="stack-scope mt-3 min-h-0" />,
  };
}
