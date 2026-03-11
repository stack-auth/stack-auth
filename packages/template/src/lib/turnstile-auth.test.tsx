/**
 * @vitest-environment jsdom
 */

import { KnownErrors } from "@stackframe/stack-shared";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnstileAuth, type TurnstileAuthRunResult } from "./turnstile-auth";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const mockApp = {};
let visibleTurnstileTokenChange: ((token: string | null) => void) | null = null;

vi.mock("./hooks", () => ({
  useStackApp: () => mockApp,
}));

vi.mock("./turnstile", () => ({
  useStagedTurnstile: (_app: object, options: {
    missingVisibleChallengeMessage: string,
    challengeRequiredMessage: string,
  }) => {
    const [challengeRequiredResult, setChallengeRequiredResult] = React.useState<"invalid" | "error" | null>(null);
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
            turnstileToken: "mock-invisible-turnstile-token",
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
        setChallengeError(options.challengeRequiredMessage);
      },
    };
  },
}));

function TurnstileAuthHarness(props: {
  onReady: (api: ReturnType<typeof useTurnstileAuth>) => void,
}) {
  const api = useTurnstileAuth({
    action: "sign_up_with_credential",
    missingVisibleChallengeMessage: "Solve the visible challenge first",
    challengeRequiredMessage: "Complete the visible challenge to continue",
  });

  React.useEffect(() => {
    props.onReady(api);
  }, [api, props]);

  return api.turnstileWidget;
}

function getLatestApi(latestApi: ReturnType<typeof useTurnstileAuth> | null): ReturnType<typeof useTurnstileAuth> {
  if (latestApi == null) {
    throw new Error("Expected turnstile auth API to be available");
  }
  return latestApi;
}

async function renderHarness(onReady: (api: ReturnType<typeof useTurnstileAuth>) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<TurnstileAuthHarness onReady={onReady} />);
  });
  return { container, root };
}

async function waitForAssertion(assertion: () => void, timeoutMs = 2000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  assertion();
}

describe("useTurnstileAuth()", () => {
  beforeEach(() => {
    visibleTurnstileTokenChange = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("completes the wrapped callback with invisible Turnstile options on the first attempt", async () => {
    let latestApi: ReturnType<typeof useTurnstileAuth> | null = null;
    const { root } = await renderHarness((api) => {
      latestApi = api;
    });

    let wrappedResult: TurnstileAuthRunResult<{
      turnstileToken: string,
      turnstilePhase: string,
    }> | null = null;
    await act(async () => {
      wrappedResult = await getLatestApi(latestApi).run(async (turnstileFlowOptions) => {
        const turnstileToken = turnstileFlowOptions.turnstileToken;
        if (turnstileToken == null) {
          throw new Error("Expected an invisible Turnstile token");
        }
        return {
          turnstileToken,
          turnstilePhase: turnstileFlowOptions.turnstilePhase ?? "invisible",
        };
      });
    });

    expect(wrappedResult).toEqual({
      status: "completed",
      result: {
        turnstileToken: "mock-invisible-turnstile-token",
        turnstilePhase: "invisible",
      },
    });
    expect(getLatestApi(latestApi).isWaitingForVisibleChallenge).toBe(false);
    expect(getLatestApi(latestApi).canSubmit).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it("handles Result.error(TurnstileChallengeRequired) and retries with visible challenge metadata", async () => {
    let latestApi: ReturnType<typeof useTurnstileAuth> | null = null;
    const { root } = await renderHarness((api) => {
      latestApi = api;
    });

    let firstResult: TurnstileAuthRunResult<{
      status: "error",
      error: InstanceType<typeof KnownErrors.TurnstileChallengeRequired>,
    }> | null = null;
    await act(async () => {
      firstResult = await getLatestApi(latestApi).run(async () => ({
        status: "error" as const,
        error: new KnownErrors.TurnstileChallengeRequired("invalid"),
      }));
    });

    expect(firstResult).toEqual({ status: "blocked" });
    await waitForAssertion(() => {
      const api = getLatestApi(latestApi);
      expect(api.isWaitingForVisibleChallenge).toBe(true);
      expect(api.canSubmit).toBe(false);
      expect(api.challengeError).toBe("Complete the visible challenge to continue");
    });

    await act(async () => {
      visibleTurnstileTokenChange?.("mock-visible-turnstile-token");
    });

    await waitForAssertion(() => {
      const api = getLatestApi(latestApi);
      expect(api.canSubmit).toBe(true);
      expect(api.challengeError).toBe(null);
    });

    let secondResult: TurnstileAuthRunResult<{
      turnstileToken: string,
      turnstilePhase: string,
      previousTurnstileResult: string,
    }> | null = null;
    await act(async () => {
      secondResult = await getLatestApi(latestApi).run(async (turnstileFlowOptions) => {
        const turnstileToken = turnstileFlowOptions.turnstileToken;
        if (turnstileToken == null) {
          throw new Error("Expected a visible Turnstile token");
        }
        const previousTurnstileResult = turnstileFlowOptions.previousTurnstileResult;
        if (previousTurnstileResult == null) {
          throw new Error("Expected the previous Turnstile result");
        }
        return {
          turnstileToken,
          turnstilePhase: turnstileFlowOptions.turnstilePhase,
          previousTurnstileResult,
        };
      });
    });

    expect(secondResult).toEqual({
      status: "completed",
      result: {
        turnstileToken: "mock-visible-turnstile-token",
        turnstilePhase: "visible",
        previousTurnstileResult: "invalid",
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("handles thrown TurnstileChallengeRequired errors and blocks submission until the visible challenge is solved", async () => {
    let latestApi: ReturnType<typeof useTurnstileAuth> | null = null;
    const { root } = await renderHarness((api) => {
      latestApi = api;
    });

    let firstResult: TurnstileAuthRunResult<void> | null = null;
    await act(async () => {
      firstResult = await getLatestApi(latestApi).run(async () => {
        throw new KnownErrors.TurnstileChallengeRequired("error");
      });
    });

    expect(firstResult).toEqual({ status: "blocked" });

    await waitForAssertion(() => {
      const api = getLatestApi(latestApi);
      expect(api.isWaitingForVisibleChallenge).toBe(true);
      expect(api.canSubmit).toBe(false);
    });

    let blockedRetry: TurnstileAuthRunResult<string> | null = null;
    await act(async () => {
      blockedRetry = await getLatestApi(latestApi).run(async () => "unexpected");
    });

    expect(blockedRetry).toEqual({ status: "blocked" });

    await waitForAssertion(() => {
      expect(getLatestApi(latestApi).challengeError).toBe("Solve the visible challenge first");
    });

    await act(async () => {
      root.unmount();
    });
  });
});
