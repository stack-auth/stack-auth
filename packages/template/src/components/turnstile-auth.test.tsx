/**
 * @vitest-environment jsdom
 */

import React, { act } from "react";
import { KnownErrors } from "@stackframe/stack-shared";
import type { TurnstileRetryResult } from "@stackframe/stack-shared/dist/utils/turnstile";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mockApp = {
  signUpWithCredential: vi.fn(),
  sendMagicLinkEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  useProject: vi.fn(() => ({
    config: {
      oauthProviders: [{ id: "google" }],
    },
  })),
};

const executeInvisibleTurnstile = vi.fn<[], Promise<string>>();
const resetVisibleTurnstile = vi.fn();
let visibleTurnstileTokenChange: ((token: string | null) => void) | null = null;

vi.mock("@stackframe/stack-ui", () => {
  const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>((props, ref) => React.createElement("input", { ...props, ref }));
  const PasswordInput = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>((props, ref) => React.createElement("input", { ...props, ref, type: "password" }));

  return {
    Button: ({ loading: _loading, ...props }: React.ComponentPropsWithoutRef<"button"> & { loading?: boolean }) => React.createElement("button", props, props.children),
    Input,
    PasswordInput,
    Label: (props: React.ComponentPropsWithoutRef<"label">) => React.createElement("label", props, props.children),
    Typography: (props: React.ComponentPropsWithoutRef<"div">) => React.createElement("div", props, props.children),
    InputOTP: (props: React.ComponentPropsWithoutRef<"div">) => React.createElement("div", props, props.children),
    InputOTPGroup: (props: React.ComponentPropsWithoutRef<"div">) => React.createElement("div", props, props.children),
    InputOTPSlot: (props: React.ComponentPropsWithoutRef<"div">) => React.createElement("div", props),
    SimpleTooltip: (props: React.ComponentPropsWithoutRef<"div">) => React.createElement("div", props, props.children),
    BrandIcons: {
      Google: () => React.createElement("span"),
      GitHub: () => React.createElement("span"),
      Facebook: () => React.createElement("span"),
      Microsoft: () => React.createElement("span"),
      Spotify: () => React.createElement("span"),
      Discord: () => React.createElement("span"),
      Gitlab: () => React.createElement("span"),
      Apple: () => React.createElement("span"),
      Bitbucket: () => React.createElement("span"),
      LinkedIn: () => React.createElement("span"),
      X: () => React.createElement("span"),
      Twitch: () => React.createElement("span"),
    },
  };
});

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: (name: string) => ({
      name,
      ref: () => {},
      onBlur: () => {},
      onChange: () => {},
    }),
    handleSubmit: (callback: (data: Record<string, string>) => Promise<void>) => async (event?: Event) => {
      event?.preventDefault();
      const form = event?.currentTarget instanceof HTMLFormElement
        ? event.currentTarget
        : event?.target instanceof HTMLFormElement
          ? event.target
          : null;
      const formData = form ? new FormData(form) : new FormData();
      await callback(Object.fromEntries(formData.entries()) as Record<string, string>);
    },
    setError: () => {},
    clearErrors: () => {},
    formState: {
      errors: {},
    },
  }),
}));

vi.mock("../lib/hooks", () => ({
  useStackApp: () => mockApp,
}));

vi.mock("../lib/translations", () => ({
  useTranslation: () => ({
    t: (value: string, templateVars?: Record<string, string>) => {
      let translated = value;
      for (const [key, replacement] of Object.entries(templateVars ?? {})) {
        translated = translated.replace(`{${key}}`, replacement);
      }
      return translated;
    },
  }),
}));

vi.mock("../lib/turnstile", () => ({
  getTurnstileInvisibleSiteKey: () => "invisible-site-key",
  getTurnstileSiteKey: () => "site-key",
  useTurnstile: (options: {
    execution?: "render" | "execute",
    enabled?: boolean,
    onTokenChange?: (token: string | null) => void,
  }) => {
    if (options.execution === "render") {
      visibleTurnstileTokenChange = options.onTokenChange ?? null;
      return {
        executeTurnstile: vi.fn(),
        resetTurnstile: resetVisibleTurnstile,
        turnstileWidget: options.enabled === false ? null : React.createElement("div", { "data-testid": "visible-turnstile-widget" }),
      };
    }

    return {
      executeTurnstile: executeInvisibleTurnstile,
      resetTurnstile: vi.fn(),
      turnstileWidget: React.createElement("div", { "data-testid": "invisible-turnstile-widget" }),
    };
  },
  useStagedTurnstile: (_app: unknown, options: {
    missingVisibleChallengeMessage: string,
    challengeRequiredMessage: string,
  }) => {
    const [challengeRequiredResult, setChallengeRequiredResult] = React.useState<TurnstileRetryResult | null>(null);
    const [visibleTurnstileToken, setVisibleTurnstileToken] = React.useState<string | null>(null);
    const [challengeError, setChallengeError] = React.useState<string | null>(null);
    visibleTurnstileTokenChange = (token) => {
      setVisibleTurnstileToken(token);
      if (token != null) {
        setChallengeError(null);
      }
    };
    return {
      challengeRequiredResult,
      visibleTurnstileToken,
      challengeError,
      invisibleTurnstileWidget: React.createElement("div", { "data-testid": "invisible-turnstile-widget" }),
      visibleTurnstileWidget: challengeRequiredResult == null ? null : React.createElement("div", { "data-testid": "visible-turnstile-widget" }),
      clearChallengeError: () => setChallengeError(null),
      getTurnstileFlowOptions: async () => {
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
      handleChallengeRequired: (error: InstanceType<typeof KnownErrors.TurnstileChallengeRequired>) => {
        const [invisibleResult] = error.constructorArgs;
        setChallengeRequiredResult(invisibleResult);
        setVisibleTurnstileToken(null);
        resetVisibleTurnstile();
        setChallengeError(options.challengeRequiredMessage);
      },
    };
  },
}));

vi.mock("./use-in-iframe", () => ({
  useInIframe: () => false,
}));

async function loadComponents() {
  const [{ CredentialSignUp }, { MagicLinkSignIn }, { OAuthButtonGroup }] = await Promise.all([
    import("./credential-sign-up"),
    import("./magic-link-sign-in"),
    import("./oauth-button-group"),
  ]);
  return { CredentialSignUp, MagicLinkSignIn, OAuthButtonGroup };
}

async function renderElement(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
  };
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected an HTMLElement to click");
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function submitForm(element: Element | null) {
  if (!(element instanceof HTMLFormElement)) {
    throw new Error("Expected an HTMLFormElement");
  }
  await act(async () => {
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function changeValue(element: Element | null, value: string) {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected an HTMLInputElement");
  }
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  assertion();
}

describe("hosted auth Turnstile integration", () => {
  beforeEach(() => {
    visibleTurnstileTokenChange = null;
    executeInvisibleTurnstile.mockResolvedValue("mock-turnstile-token");
    mockApp.signUpWithCredential.mockResolvedValue({ status: "ok", data: undefined });
    mockApp.sendMagicLinkEmail.mockResolvedValue({ status: "ok", data: { nonce: "nonce" } });
    mockApp.signInWithOAuth.mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("passes a Turnstile token through credential signup", async () => {
    const { CredentialSignUp } = await loadComponents();
    const { container, root } = await renderElement(React.createElement(CredentialSignUp));

    await changeValue(container.querySelector("#email"), "user@example.com");
    await changeValue(container.querySelector("#password"), "password123");
    await changeValue(container.querySelector("#repeat-password"), "password123");
    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.signUpWithCredential).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "password123",
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("passes a Turnstile token through magic link send", async () => {
    const { MagicLinkSignIn } = await loadComponents();
    const { container, root } = await renderElement(React.createElement(MagicLinkSignIn));

    await changeValue(container.querySelector("#email"), "user@example.com");
    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.sendMagicLinkEmail).toHaveBeenCalledWith("user@example.com", {
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("passes a Turnstile token through OAuth authenticate", async () => {
    const { OAuthButtonGroup } = await loadComponents();
    const { container, root } = await renderElement(React.createElement(OAuthButtonGroup, { type: "sign-in" }));

    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Sign in with Google")) ?? null);

    await waitForAssertion(() => {
      expect(mockApp.signInWithOAuth).toHaveBeenCalledWith("google", {
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("requires a visible Turnstile challenge after the invisible attempt is rejected", async () => {
    const { CredentialSignUp } = await loadComponents();
    mockApp.signUpWithCredential
      .mockResolvedValueOnce({ status: "error", error: new KnownErrors.TurnstileChallengeRequired("invalid") })
      .mockResolvedValueOnce({ status: "ok", data: undefined });

    const { container, root } = await renderElement(React.createElement(CredentialSignUp));

    await changeValue(container.querySelector("#email"), "user@example.com");
    await changeValue(container.querySelector("#password"), "password123");
    await changeValue(container.querySelector("#repeat-password"), "password123");
    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.signUpWithCredential).toHaveBeenNthCalledWith(1, {
        email: "user@example.com",
        password: "password123",
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    const submitButton = container.querySelector("button");
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error("Expected submit button");
    }
    expect(submitButton.disabled).toBe(true);

    await act(async () => {
      visibleTurnstileTokenChange?.("mock-visible-turnstile-token");
    });
    expect(submitButton.disabled).toBe(false);

    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.signUpWithCredential).toHaveBeenNthCalledWith(2, {
        email: "user@example.com",
        password: "password123",
        previousTurnstileResult: "invalid",
        turnstilePhase: "visible",
        turnstileToken: "mock-visible-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("retries magic link send with a visible Turnstile challenge after an invisible failure", async () => {
    const { MagicLinkSignIn } = await loadComponents();
    mockApp.sendMagicLinkEmail
      .mockResolvedValueOnce({ status: "error", error: new KnownErrors.TurnstileChallengeRequired("invalid") })
      .mockResolvedValueOnce({ status: "ok", data: { nonce: "nonce" } });

    const { container, root } = await renderElement(React.createElement(MagicLinkSignIn));

    await changeValue(container.querySelector("#email"), "user@example.com");
    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.sendMagicLinkEmail).toHaveBeenNthCalledWith(1, "user@example.com", {
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    const submitButton = container.querySelector("button");
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error("Expected submit button");
    }
    expect(submitButton.disabled).toBe(true);

    await act(async () => {
      visibleTurnstileTokenChange?.("mock-visible-turnstile-token");
    });
    expect(submitButton.disabled).toBe(false);

    await submitForm(container.querySelector("form"));

    await waitForAssertion(() => {
      expect(mockApp.sendMagicLinkEmail).toHaveBeenNthCalledWith(2, "user@example.com", {
        previousTurnstileResult: "invalid",
        turnstilePhase: "visible",
        turnstileToken: "mock-visible-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("retries OAuth authenticate with a visible Turnstile challenge after an invisible failure", async () => {
    const { OAuthButtonGroup } = await loadComponents();
    mockApp.signInWithOAuth
      .mockRejectedValueOnce(new KnownErrors.TurnstileChallengeRequired("invalid"))
      .mockResolvedValueOnce(undefined);

    const { container, root } = await renderElement(React.createElement(OAuthButtonGroup, { type: "sign-in" }));

    await click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Sign in with Google")) ?? null);

    await waitForAssertion(() => {
      expect(mockApp.signInWithOAuth).toHaveBeenNthCalledWith(1, "google", {
        turnstilePhase: "invisible",
        turnstileToken: "mock-turnstile-token",
      });
    });

    const signInButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Sign in with Google"));
    if (!(signInButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Google sign-in button");
    }
    expect(signInButton.disabled).toBe(true);

    await act(async () => {
      visibleTurnstileTokenChange?.("mock-visible-turnstile-token");
    });
    expect(signInButton.disabled).toBe(false);

    await click(signInButton);

    await waitForAssertion(() => {
      expect(mockApp.signInWithOAuth).toHaveBeenNthCalledWith(2, "google", {
        previousTurnstileResult: "invalid",
        turnstilePhase: "visible",
        turnstileToken: "mock-visible-turnstile-token",
      });
    });

    await act(async () => {
      root.unmount();
    });
  });
});
