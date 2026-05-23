/**
 * Ensures `observeAndLog` returns upstream bytes even when proxy logging throws.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./loggers/ai-proxy-logger", () => ({
  buildProxyLogRow: vi.fn(),
  scheduleProxyLog: vi.fn(),
}));

vi.mock("./openrouter-usage", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    extractOpenRouterUsage: vi.fn(() => ({})),
    scanSseForUsage: vi.fn(async () => ({})),
  };
});

vi.mock("@/private", () => ({
  preprocessProxyBody: ({ parsedBody }: { parsedBody: unknown }) => parsedBody,
}));

import { buildProxyLogRow, scheduleProxyLog } from "./loggers/ai-proxy-logger";
import { observeAndLog, sanitizeBody } from "./ai-proxy-handlers";

const sanitized = sanitizeBody(new TextEncoder().encode(JSON.stringify({
  model: "anthropic/claude-sonnet-4.6",
  messages: [{ role: "user", content: "hi" }],
})).buffer as ArrayBuffer);

describe("observeAndLog body delivery", () => {
  it("returns the upstream bytes even if buildProxyLogRow throws", async () => {
    vi.mocked(buildProxyLogRow).mockImplementation(() => {
      throw new Error("synthetic log construction failure");
    });
    vi.mocked(scheduleProxyLog).mockClear();

    const upstreamBody = JSON.stringify({ id: "gen-1", choices: [{ message: { content: "hello" } }] });
    const upstream = new Response(upstreamBody, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const out = await observeAndLog({
      response: upstream,
      sanitizedBody: sanitized,
      callerApiKey: "stack-auth-test",
      correlationId: "corr-1",
      startedAt: 0,
      responseHeaders: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

    expect(out.status).toBe(200);
    expect(await out.text()).toBe(upstreamBody);
  });

  it("returns the upstream bytes even if scheduleProxyLog throws", async () => {
    vi.mocked(buildProxyLogRow).mockReturnValue({
      correlationId: "corr-2",
      mode: "generate",
      systemPromptId: "stack-auth-test",
      quality: "unknown",
      speed: "unknown",
      modelId: "anthropic/claude-sonnet-4.6",
      isAuthenticated: false,
      projectId: undefined,
      userId: undefined,
      requestedToolsJson: "[]",
      messagesJson: "[]",
      stepsJson: "[]",
      finalText: "",
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
      cacheCreationTokens: undefined,
      costUsd: undefined,
      cacheDiscountUsd: undefined,
      openrouterGenerationId: undefined,
      stepCount: 0,
      durationMs: 0n,
      errorMessage: undefined,
      conversationId: undefined,
    });
    vi.mocked(scheduleProxyLog).mockImplementation(() => {
      throw new Error("synthetic schedule failure");
    });

    const upstreamBody = JSON.stringify({ id: "gen-2", choices: [{ message: { content: "world" } }] });
    const upstream = new Response(upstreamBody, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const out = await observeAndLog({
      response: upstream,
      sanitizedBody: sanitized,
      callerApiKey: "stack-auth-test",
      correlationId: "corr-2",
      startedAt: 0,
      responseHeaders: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

    expect(out.status).toBe(200);
    expect(await out.text()).toBe(upstreamBody);
  });

  it("delivers full streamed bytes via tee even when the observer arm throws", async () => {
    vi.mocked(buildProxyLogRow).mockImplementation(() => {
      throw new Error("synthetic log failure inside async observer");
    });

    const streamPayload = "data: {\"id\":\"gen-3\"}\n\ndata: [DONE]\n\n";
    const upstream = new Response(streamPayload, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const streamingSanitized = sanitizeBody(new TextEncoder().encode(JSON.stringify({
      model: "anthropic/claude-sonnet-4.6",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    })).buffer as ArrayBuffer);

    const out = await observeAndLog({
      response: upstream,
      sanitizedBody: streamingSanitized,
      callerApiKey: "stack-auth-test",
      correlationId: "corr-3",
      startedAt: 0,
      responseHeaders: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });

    expect(out.status).toBe(200);
    expect(await out.text()).toBe(streamPayload);
  });
});
