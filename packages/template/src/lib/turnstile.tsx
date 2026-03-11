'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import type { TurnstileRetryResult } from "@stackframe/stack-shared/dist/utils/turnstile";
import { turnstileDevelopmentKeys } from "@stackframe/stack-shared/dist/utils/turnstile";
import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import { getTurnstileApi, loadTurnstileScript } from "@stackframe/stack-shared/dist/utils/turnstile-browser";
import type { TurnstileAppearance, TurnstileExecution, TurnstileSize, TurnstileWidgetId } from "@stackframe/stack-shared/dist/utils/turnstile-browser";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React, { useEffect, useRef, useState } from "react";
import { StackClientApp, stackAppInternalsSymbol } from "./stack-app";

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
    return turnstileDevelopmentKeys.visibleSiteKey;
  }
  return throwErr("Turnstile site key is not configured");
}

export function getTurnstileInvisibleSiteKey(app: StackClientApp): string {
  return app[stackAppInternalsSymbol].getConstructorOptions().fraudProtection?.turnstileInvisibleSiteKey
    ?? process.env.NEXT_PUBLIC_STACK_TURNSTILE_INVISIBLE_SITE_KEY
    ?? (isDevelopmentLikeEnvironment() ? turnstileDevelopmentKeys.invisibleSiteKey : getTurnstileSiteKey(app));
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
    if (!widgetId || !turnstileApi || typeof turnstileApi.execute !== "function") {
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

    try {
      turnstileApi.execute(widgetId);
    } catch (error) {
      pendingPromiseRef.current = null;
      onTokenChange(null);
      throw error;
    }
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

export function useStagedTurnstile(app: StackClientApp, options: {
  action: TurnstileAction,
  missingVisibleChallengeMessage: string,
  challengeRequiredMessage: string,
}) {
  const visibleTurnstileSiteKey = getTurnstileSiteKey(app);
  const invisibleTurnstileSiteKey = getTurnstileInvisibleSiteKey(app);
  const usesDedicatedInvisibleTurnstileSiteKey = invisibleTurnstileSiteKey !== visibleTurnstileSiteKey;
  const [challengeRequiredResult, setChallengeRequiredResult] = useState<TurnstileRetryResult | null>(null);
  const [visibleTurnstileToken, setVisibleTurnstileToken] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const { executeTurnstile: executeInvisibleTurnstile, turnstileWidget: invisibleTurnstileWidget } = useTurnstile({
    siteKey: invisibleTurnstileSiteKey,
    action: options.action,
    appearance: "interaction-only",
    execution: "execute",
    size: usesDedicatedInvisibleTurnstileSiteKey ? "invisible" : undefined,
  });
  const {
    resetTurnstile: resetVisibleTurnstile,
    turnstileWidget: visibleTurnstileWidget,
  } = useTurnstile({
    siteKey: visibleTurnstileSiteKey,
    action: options.action,
    appearance: "always",
    execution: "render",
    size: "flexible",
    enabled: challengeRequiredResult != null,
    onTokenChange: (token) => {
      setVisibleTurnstileToken(token);
      if (token != null) {
        setChallengeError(null);
      }
    },
    onError: (message) => {
      setChallengeError(message);
    },
  });

  return {
    challengeRequiredResult,
    visibleTurnstileToken,
    challengeError,
    invisibleTurnstileWidget,
    visibleTurnstileWidget: challengeRequiredResult != null ? visibleTurnstileWidget : null,
    clearChallengeError: () => setChallengeError(null),
    async getTurnstileFlowOptions() {
      if (challengeRequiredResult == null) {
        return {
          turnstileToken: await executeInvisibleTurnstile(),
          turnstilePhase: "invisible" as const,
        };
      }

      if (visibleTurnstileToken == null) {
        setChallengeError(options.missingVisibleChallengeMessage);
        return null;
      }

      return {
        turnstileToken: visibleTurnstileToken,
        turnstilePhase: "visible" as const,
        previousTurnstileResult: challengeRequiredResult,
      };
    },
    handleChallengeRequired(error: InstanceType<typeof KnownErrors.TurnstileChallengeRequired>) {
      const [invisibleResult] = error.constructorArgs;
      setChallengeRequiredResult(invisibleResult);
      setVisibleTurnstileToken(null);
      resetVisibleTurnstile();
      setChallengeError(options.challengeRequiredMessage);
    },
  };
}
