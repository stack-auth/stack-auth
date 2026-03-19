// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTurnstileScriptMock = vi.fn(() => Promise.resolve());
const renderMock = vi.fn();
const executeMock = vi.fn();
const removeMock = vi.fn();
const captureErrorMock = vi.fn();

vi.mock("./turnstile-browser", () => ({
  loadTurnstileScript: loadTurnstileScriptMock,
  getTurnstileApi: () => ({
    render: renderMock,
    execute: executeMock,
    remove: removeMock,
  }),
}));

vi.mock("./errors", async () => {
  const actual = await vi.importActual<typeof import("./errors")>("./errors");
  return {
    ...actual,
    captureError: captureErrorMock,
  };
});

describe("withBotChallengeFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTurnstileScriptMock.mockResolvedValue(undefined);
    renderMock.mockImplementation((_container, config: {
      callback: (token: string) => void,
    }) => {
      config.callback("invisible-token");
      return "widget-id";
    });
    executeMock.mockImplementation(() => {});
    removeMock.mockImplementation(() => {});
  });

  it("throws a bot challenge execution error when the phase-2 visible challenge fails", async () => {
    const { BotChallengeExecutionFailedError, withBotChallengeFlow } = await import("./turnstile-flow");

    loadTurnstileScriptMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("cloudflare unavailable"));

    const execute = vi.fn(async ({ token, phase }: { token?: string, phase?: "invisible" | "visible" }) => {
      if (token === "invisible-token" && phase === "invisible") {
        return { requiresChallenge: true };
      }
      return { requiresChallenge: false };
    });

    await expect(withBotChallengeFlow({
      visibleSiteKey: "visible-site-key",
      invisibleSiteKey: "invisible-site-key",
      action: "sign_up_with_credential",
      execute,
      isChallengeRequired: (result) => result.requiresChallenge,
    })).rejects.toBeInstanceOf(BotChallengeExecutionFailedError);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      token: "invisible-token",
      phase: "invisible",
    });
    expect(captureErrorMock).toHaveBeenCalledWith(
      "turnstile-flow-visible-challenge-failed",
      expect.any(Error),
    );
  });
});
