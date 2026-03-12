import { StackAssertionError } from "./errors";
import { TurnstileAction } from "./turnstile";

export type TurnstileWidgetId = string;
export type TurnstileTheme = "auto" | "light" | "dark";
export type TurnstileAppearance = "always" | "execute" | "interaction-only";
export type TurnstileExecution = "render" | "execute";
export type TurnstileSize = "invisible" | "flexible" | "normal" | "compact";

export type TurnstileConfig = {
  sitekey: string,
  action: TurnstileAction,
  theme?: TurnstileTheme,
  appearance?: TurnstileAppearance,
  execution?: TurnstileExecution,
  size?: TurnstileSize,
  callback: (token: string) => void,
  "error-callback": (errorCode?: string) => void,
  "expired-callback": () => void,
  "timeout-callback"?: () => void,
};

export type TurnstileApi = {
  render: (container: HTMLElement, config: TurnstileConfig) => TurnstileWidgetId,
  execute?: (widgetId: TurnstileWidgetId) => void,
  remove: (widgetId: TurnstileWidgetId) => void,
  reset?: (widgetId: TurnstileWidgetId) => void,
};

export function isTurnstileApi(value: unknown): value is TurnstileApi {
  return typeof value === "object"
    && value !== null
    && "render" in value
    && "remove" in value;
}

export function getTurnstileApi(): TurnstileApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const maybeTurnstile = Reflect.get(window, "turnstile");
  return isTurnstileApi(maybeTurnstile) ? maybeTurnstile : undefined;
}

let turnstileScriptPromise: Promise<void> | null = null;

export function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new StackAssertionError("Turnstile can only be loaded in the browser"));
  }

  if (getTurnstileApi()) {
    return Promise.resolve();
  }

  turnstileScriptPromise ??= new Promise<void>((resolve, reject) => {
    const rejectAndReset = (err: Error) => {
      turnstileScriptPromise = null;
      reject(err);
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => {
        existingScript.remove();
        rejectAndReset(new Error("Failed to load Turnstile"));
      }, { once: true });
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
    script.onerror = () => {
      script.remove();
      rejectAndReset(new Error("Failed to load Turnstile"));
    };
    document.head.append(script);
  });

  return turnstileScriptPromise;
}
