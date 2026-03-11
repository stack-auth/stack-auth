/**
 * @vitest-environment jsdom
 */

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "../test-utils/react-dom-client";
import { useTurnstile } from "./turnstile";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("./stack-app", () => ({
  StackClientApp: class StackClientApp {},
  stackAppInternalsSymbol: Symbol("stackAppInternalsSymbol"),
}));

function withTimeout<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function TurnstileHarness(props: {
  onReady: (executeTurnstile: () => Promise<string>) => void,
  onError?: (message: string) => void,
  onTokenChange?: (token: string | null) => void,
}) {
  const { executeTurnstile, turnstileWidget } = useTurnstile({
    siteKey: "site-key",
    action: "sign_up_with_credential",
    execution: "execute",
    onError: props.onError,
    onTokenChange: props.onTokenChange,
  });

  React.useEffect(() => {
    props.onReady(executeTurnstile);
  }, [executeTurnstile, props]);

  return turnstileWidget;
}

describe("useTurnstile()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "turnstile");
  });

  it("clears the pending execute promise when turnstile.execute throws synchronously", async () => {
    let executeTurnstile: (() => Promise<string>) | undefined;
    let renderedConfig: { callback: (token: string) => void } | undefined;
    const execute = vi.fn<[], void>(() => {
      throw new Error("sync execute failed");
    });

    Reflect.set(window, "turnstile", {
      render: vi.fn((_container: HTMLElement, config: { callback: (token: string) => void }) => {
        renderedConfig = config;
        return "widget-id";
      }),
      execute,
      remove: vi.fn(),
      reset: vi.fn(),
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<TurnstileHarness onReady={(fn) => {
        executeTurnstile = fn;
      }} />);
    });

    if (executeTurnstile == null) {
      throw new Error("executeTurnstile was not initialized");
    }

    await expect(executeTurnstile()).rejects.toThrowError("sync execute failed");

    execute.mockImplementation(() => {
      renderedConfig?.callback("retry-token");
    });

    await expect(withTimeout(executeTurnstile())).resolves.toBe("retry-token");

    act(() => {
      root.unmount();
    });
  });

  it("rejects executeTurnstile when the Turnstile error callback fires", async () => {
    let executeTurnstile: (() => Promise<string>) | undefined;
    let renderedConfig: {
      callback: (token: string) => void,
      "error-callback": (errorCode?: string) => void,
    } | undefined;
    const onError = vi.fn();
    const onTokenChange = vi.fn();

    Reflect.set(window, "turnstile", {
      render: vi.fn((_container: HTMLElement, config: typeof renderedConfig extends infer T ? T : never) => {
        renderedConfig = config;
        return "widget-id";
      }),
      execute: vi.fn(() => {
        renderedConfig?.["error-callback"]("forced-error");
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<TurnstileHarness
        onReady={(fn) => {
          executeTurnstile = fn;
        }}
        onError={onError}
        onTokenChange={onTokenChange}
      />);
    });

    if (executeTurnstile == null) {
      throw new Error("executeTurnstile was not initialized");
    }

    await expect(executeTurnstile()).rejects.toThrowError("Turnstile verification failed");
    expect(onError).toHaveBeenCalledWith("Turnstile verification failed. Try again.");
    expect(onTokenChange).toHaveBeenLastCalledWith(null);

    act(() => {
      root.unmount();
    });
  });

  it("reports token expiration via onError and clears the token", async () => {
    let renderedConfig: {
      callback: (token: string) => void,
      "expired-callback": () => void,
    } | undefined;
    const onError = vi.fn();
    const onTokenChange = vi.fn();

    Reflect.set(window, "turnstile", {
      render: vi.fn((_container: HTMLElement, config: typeof renderedConfig extends infer T ? T : never) => {
        renderedConfig = config;
        return "widget-id";
      }),
      execute: vi.fn(),
      remove: vi.fn(),
      reset: vi.fn(),
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<TurnstileHarness onReady={() => {}} onError={onError} onTokenChange={onTokenChange} />);
    });

    renderedConfig?.callback("visible-token");
    renderedConfig?.["expired-callback"]();

    expect(onError).toHaveBeenCalledWith("Turnstile token expired. Solve the challenge again.");
    expect(onTokenChange).toHaveBeenLastCalledWith(null);

    act(() => {
      root.unmount();
    });
  });

  it("reuses the same pending execute promise for concurrent calls", async () => {
    let executeTurnstile: (() => Promise<string>) | undefined;
    let renderedConfig: { callback: (token: string) => void } | undefined;
    const execute = vi.fn(() => {});

    Reflect.set(window, "turnstile", {
      render: vi.fn((_container: HTMLElement, config: typeof renderedConfig extends infer T ? T : never) => {
        renderedConfig = config;
        return "widget-id";
      }),
      execute,
      remove: vi.fn(),
      reset: vi.fn(),
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<TurnstileHarness onReady={(fn) => {
        executeTurnstile = fn;
      }} />);
    });

    if (executeTurnstile == null) {
      throw new Error("executeTurnstile was not initialized");
    }

    const firstPromise = executeTurnstile();
    const secondPromise = executeTurnstile();

    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);

    renderedConfig?.callback("shared-token");

    await expect(firstPromise).resolves.toBe("shared-token");
    await expect(secondPromise).resolves.toBe("shared-token");

    act(() => {
      root.unmount();
    });
  });
});
