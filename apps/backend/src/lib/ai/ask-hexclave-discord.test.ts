import { afterEach, describe, expect, it, vi } from "vitest";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { globalVar } from "@hexclave/shared/dist/utils/globals";

import {
  buildAskHexclaveDiscordPayload,
  sendAskHexclaveDiscordNotification,
} from "./ask-hexclave-discord";

function restoreEnvVariable(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

const baseOptions = {
  conversationId: "conversation-123",
  question: "How do I configure OAuth?",
  response: "Use the OAuth provider configuration in your project settings.",
  reason: "User asked about OAuth",
  userPrompt: "Help me set up OAuth with GitHub",
  requestMetadata: {
    transport: "skill-ask" as const,
    requestIp: "203.0.113.10",
    requestIpSource: "x-forwarded-for",
    userAgent: "skill-test-agent/1.0",
    requestHost: "skill.hexclave.com",
    mcpProtocolVersion: null,
  },
  modelId: "test-model",
  stepCount: 2,
  durationMs: 1234,
};

describe("ask Hexclave Discord notifications", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds a truncated Discord embed with request metadata", () => {
    const payload = buildAskHexclaveDiscordPayload({
      ...baseOptions,
      question: "Q".repeat(300),
      response: "R".repeat(4_000),
    });

    expect(payload.content).toBe("**Ask Hexclave** · Skill /ask");
    expect(payload.embeds[0].title.length).toBeLessThanOrEqual(250);
    expect(payload.embeds[0].description.length).toBeLessThanOrEqual(3_500);
    expect(payload.embeds[0].fields).toEqual(expect.arrayContaining([
      { name: "Request IP", value: "203.0.113.10 (x-forwarded-for)", inline: true },
      { name: "Host", value: "skill.hexclave.com", inline: true },
      { name: "Conversation", value: "conversation-123", inline: true },
    ]));
  });

  it("does nothing when the webhook URL env var is unset", async () => {
    const previous = process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL;
    delete process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL;
    delete process.env.STACK_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await sendAskHexclaveDiscordNotification(baseOptions);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreEnvVariable("HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL", previous);
    }
  });

  it("posts the Discord payload when a valid webhook URL is configured", async () => {
    const previous = process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL;
    process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await sendAskHexclaveDiscordNotification(baseOptions);
      expect(fetchMock).toHaveBeenCalledOnce();
      const call = fetchMock.mock.calls[0];
      if (call == null) {
        throwErr("Expected Discord webhook fetch to be called");
      }
      const [url, init] = call;
      expect(String(url)).toBe("https://discord.com/api/webhooks/123/abc");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        content: "**Ask Hexclave** · Skill /ask",
        embeds: [{
          title: "How do I configure OAuth?",
          description: "Use the OAuth provider configuration in your project settings.",
        }],
      });
    } finally {
      restoreEnvVariable("HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL", previous);
    }
  });

  it("rejects non-Discord webhook hosts without fetching", async () => {
    globalVar.hexclaveCapturedErrors = [];
    const previous = process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL;
    process.env.HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL = "https://example.com/api/webhooks/123/abc";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await sendAskHexclaveDiscordNotification(baseOptions);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(globalVar.hexclaveCapturedErrors?.at(-1)).toMatchObject({
        location: "ask-hexclave-discord-webhook-url",
      });
    } finally {
      restoreEnvVariable("HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL", previous);
    }
  });
});
