import { afterEach, describe, expect, it, vi } from "vitest";

import { callHexclaveAskAi, HEXCLAVE_ASK_PUBLIC_ERROR_MESSAGE } from "./hexclave-ask";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callHexclaveAskAi", () => {
  it("returns the safe public error when the backend connection fails", async () => {
    const requestError = new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:8102");
    const onDiagnostic = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw requestError;
    }));

    await expect(callHexclaveAskAi({
      backendApiBaseUrl: "http://localhost:8102",
      question: "How do I configure OAuth?",
      reason: "test",
      userPrompt: "How do I configure OAuth?",
      onDiagnostic,
    })).resolves.toEqual({
      status: "error",
      message: HEXCLAVE_ASK_PUBLIC_ERROR_MESSAGE,
    });
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith({
      event: "request-error",
      error: requestError,
    });
  });

  it("does not synthesize a conversation ID when the backend omits one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      finalText: "Use the OAuth provider configuration.",
    }))));

    await expect(callHexclaveAskAi({
      backendApiBaseUrl: "https://api.hexclave.test",
      question: "How do I configure OAuth?",
      reason: "test",
      userPrompt: "How do I configure OAuth?",
    })).resolves.toEqual({
      status: "ok",
      text: "Use the OAuth provider configuration.",
      conversationId: undefined,
    });
  });
});
