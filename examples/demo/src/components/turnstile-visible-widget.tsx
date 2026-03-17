'use client';

import type { TurnstileAction } from "@stackframe/stack-shared/dist/utils/turnstile";
import { getTurnstileApi, loadTurnstileScript } from "@stackframe/stack-shared/dist/utils/turnstile-browser";
import type { TurnstileWidgetId } from "@stackframe/stack-shared/dist/utils/turnstile-browser";
import { useEffect, useRef } from "react";

export function TurnstileVisibleWidget(props: {
  siteKey: string,
  action: TurnstileAction,
  onTokenChange: (token: string | null) => void,
  onError?: (message: string) => void,
}) {
  const { action, siteKey } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const onTokenChangeRef = useRef(props.onTokenChange);
  const onErrorRef = useRef(props.onError);

  useEffect(() => {
    onTokenChangeRef.current = props.onTokenChange;
    onErrorRef.current = props.onError;
  }, [props.onTokenChange, props.onError]);

  useEffect(() => {
    onTokenChangeRef.current(null);

    const container = containerRef.current;
    if (container == null) {
      return;
    }

    const state = {
      cancelled: false,
    };

    const loadPromise = (async () => {
      await loadTurnstileScript();
      const turnstileApi = getTurnstileApi();
      if (state.cancelled) {
        return;
      }
      if (!turnstileApi) {
        onErrorRef.current?.("Failed to initialize Turnstile");
        onTokenChangeRef.current(null);
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
          onTokenChangeRef.current(token);
        },
        "error-callback": (errorCode) => {
          onTokenChangeRef.current(null);
          onErrorRef.current?.(errorCode ? `Turnstile error: ${errorCode}` : "Turnstile verification failed");
        },
        "expired-callback": () => {
          onTokenChangeRef.current(null);
          onErrorRef.current?.("Turnstile token expired. Solve the challenge again.");
        },
        "timeout-callback": () => {
          onTokenChangeRef.current(null);
          onErrorRef.current?.("Turnstile challenge timed out. Solve it again.");
        },
      });
    })();

    loadPromise.catch((error: unknown) => {
      if (state.cancelled) return;
      onTokenChangeRef.current(null);
      onErrorRef.current?.(error instanceof Error ? error.message : "Failed to load Turnstile");
    });

    return () => {
      state.cancelled = true;
      onTokenChangeRef.current(null);
      const turnstileApi = getTurnstileApi();
      if (widgetIdRef.current != null && turnstileApi) {
        turnstileApi.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, siteKey]);

  return <div ref={containerRef} className="w-full min-h-16" />;
}
