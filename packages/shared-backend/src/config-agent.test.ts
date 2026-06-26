import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn(async function* (_input: unknown) {
  yield { type: "result", result: "done" };
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
}));

let originalProxyUrl: string | undefined;

beforeEach(() => {
  originalProxyUrl = process.env.STACK_CLAUDE_PROXY_URL;
  delete process.env.STACK_CLAUDE_PROXY_URL;
  vi.resetModules();
  queryMock.mockClear();
});

afterEach(() => {
  if (originalProxyUrl === undefined) {
    delete process.env.STACK_CLAUDE_PROXY_URL;
  } else {
    process.env.STACK_CLAUDE_PROXY_URL = originalProxyUrl;
  }
});

describe("runHeadlessClaudeAgent", () => {
  it("defaults to the latest AI proxy endpoint", async () => {
    const { runHeadlessClaudeAgent } = await import("./config-agent");

    await runHeadlessClaudeAgent({
      prompt: "update the config",
      cwd: process.cwd(),
      allowedTools: [],
    });

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_BASE_URL: "https://api.hexclave.com/api/latest/integrations/ai-proxy",
        }),
      }),
    }));
  });

  it("allows the agent proxy endpoint to be overridden", async () => {
    process.env.STACK_CLAUDE_PROXY_URL = "https://example.com/agent-proxy";
    const { runHeadlessClaudeAgent } = await import("./config-agent");

    await runHeadlessClaudeAgent({
      prompt: "update the config",
      cwd: process.cwd(),
      allowedTools: [],
    });

    expect(queryMock).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_BASE_URL: "https://example.com/agent-proxy",
        }),
      }),
    }));
  });
});
