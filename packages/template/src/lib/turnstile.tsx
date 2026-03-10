import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import React, { useEffect, useRef } from "react";
import { StackClientApp, stackAppInternalsSymbol } from "./stack-app";

type TurnstileWidgetId = string;

type TurnstileConfig = {
  sitekey: string,
  action: TurnstileAction,
  appearance: "interaction-only",
  execution: "execute",
  callback: (token: string) => void,
  "error-callback": () => void,
  "expired-callback": () => void,
};

type TurnstileApi = {
  render: (container: HTMLElement, config: TurnstileConfig) => TurnstileWidgetId,
  execute: (widgetId: TurnstileWidgetId) => void,
  remove: (widgetId: TurnstileWidgetId) => void,
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

export function getTurnstileSiteKey(app: StackClientApp): string | undefined {
  return app[stackAppInternalsSymbol].getConstructorOptions().fraudProtection?.turnstileSiteKey
    ?? process.env.NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY
    ?? undefined;
}

export function useTurnstile(options: {
  siteKey?: string,
  action: TurnstileAction,
}) {
  const siteKey = options.siteKey;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const widgetReadyRef = useRef<Promise<void> | null>(null);
  const pendingPromiseRef = useRef<{
    resolve: (token: string) => void,
    reject: (error: Error) => void,
    promise: Promise<string>,
  } | null>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      widgetReadyRef.current = null;
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
        appearance: "interaction-only",
        execution: "execute",
        callback: (token) => {
          pendingPromiseRef.current?.resolve(token);
          pendingPromiseRef.current = null;
        },
        "error-callback": () => {
          pendingPromiseRef.current?.reject(new Error("Turnstile verification failed"));
          pendingPromiseRef.current = null;
        },
        "expired-callback": () => {
          pendingPromiseRef.current?.reject(new Error("Turnstile token expired"));
          pendingPromiseRef.current = null;
        },
      });
    })();

    return () => {
      state.cancelled = true;
      pendingPromiseRef.current?.reject(new Error("Turnstile widget was unmounted"));
      pendingPromiseRef.current = null;

      const turnstileApi = getTurnstileApi();
      if (widgetIdRef.current && turnstileApi) {
        turnstileApi.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [options.action, siteKey]);

  async function executeTurnstile(): Promise<string | null> {
    if (!siteKey) {
      return null;
    }

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

  return {
    executeTurnstile,
    turnstileWidget: siteKey
      ? <div ref={containerRef} className="stack-scope mt-3 min-h-0" />
      : null,
  };
}
