import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalVar } from "@hexclave/shared/dist/utils/globals";

import { handleAskToolRoute } from "./ask-route";

function restoreEnvVariable(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("skill-site ask route", () => {
  beforeEach(() => {
    globalVar.hexclaveCapturedErrors = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call the backend for HEAD requests", async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("https://skill.hexclave.com/ask", { method: "HEAD" }));
      expect(response.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("directly calls the unified AI endpoint for ask requests", async () => {
    const previousFetch = globalThis.fetch;
    const previousHexclaveApiUrl = process.env.NEXT_PUBLIC_HEXCLAVE_API_URL;
    process.env.NEXT_PUBLIC_HEXCLAVE_API_URL = "https://api.hexclave.test";

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe("https://api.hexclave.test/api/latest/ai/query/generate");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      expect(body).toMatchInlineSnapshot(`
        {
          "mcpCallMetadata": {
            "conversationId": "conversation-123",
            "reason": "skill-site ask endpoint",
            "toolName": "ask_hexclave",
            "userPrompt": "Installing Hexclave in a static HTML app",
          },
          "messages": [
            {
              "content": "How do I add Hexclave?",
              "role": "user",
            },
          ],
          "quality": "smart",
          "speed": "fast",
          "systemPrompt": "docs-ask-ai",
          "tools": [
            "docs",
          ],
        }
      `);

      return new Response(JSON.stringify({
        finalText: "Use the JS SDK or REST API.",
        conversationId: "conversation-123",
      }));
    });

    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("https://skill.hexclave.com/ask?query=How%20do%20I%20add%20Hexclave%3F&context=Installing%20Hexclave%20in%20a%20static%20HTML%20app&conversationId=conversation-123&reason=caller-controlled"));
      expect(response.status).toBe(200);
      expect(await response.text()).toMatchInlineSnapshot(`
        "Use the JS SDK or REST API.

        [conversationId: conversation-123 - pass this value as the conversationId parameter in your next /ask request to continue this conversation]"
      `);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", previousHexclaveApiUrl);
    }
  });

  it("handles malformed successful backend responses as controlled errors", async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("<html>not json</html>"));
    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("https://skill.hexclave.com/ask?question=Hello"));
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Hexclave AI is temporarily unavailable. Please try again later.");
      expect(globalVar.hexclaveCapturedErrors?.at(-1)).toMatchObject({
        location: "skill-site-ask-malformed-json",
        level: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("Hexclave AI ask endpoint returned malformed JSON"),
          name: "HexclaveAssertionError",
        }),
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("returns a controlled error when the backend request times out", async () => {
    vi.useFakeTimers();
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });
    globalThis.fetch = fetchMock;

    try {
      const responsePromise = handleAskToolRoute(new Request("https://skill.hexclave.com/ask?question=Hello"));
      await vi.advanceTimersByTimeAsync(45_000);
      const response = await responsePromise;
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Hexclave AI is temporarily unavailable. Please try again later.");
      expect(globalVar.hexclaveCapturedErrors?.at(-1)).toMatchObject({
        location: "skill-site-ask-timeout",
        level: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("Hexclave AI ask endpoint timed out"),
          name: "HexclaveAssertionError",
        }),
      });
    } finally {
      globalThis.fetch = previousFetch;
      vi.useRealTimers();
    }
  });

  it("returns a controlled error when the backend stalls while streaming the response body", async () => {
    vi.useFakeTimers();
    const previousFetch = globalThis.fetch;
    // Simulates real fetch behavior: headers arrive immediately, but the body stream never
    // produces data. Like undici, aborting the request signal errors the pending body read.
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stalledBody = new ReadableStream<Uint8Array>({
        start(streamController) {
          init?.signal?.addEventListener("abort", () => {
            streamController.error(new DOMException("The operation was aborted", "AbortError"));
          });
        },
      });
      return new Response(stalledBody);
    });
    globalThis.fetch = fetchMock;

    try {
      const responsePromise = handleAskToolRoute(new Request("https://skill.hexclave.com/ask?question=Hello"));
      await vi.advanceTimersByTimeAsync(45_000);
      const response = await responsePromise;
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Hexclave AI is temporarily unavailable. Please try again later.");
      expect(globalVar.hexclaveCapturedErrors?.at(-1)).toMatchObject({
        location: "skill-site-ask-timeout",
        level: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("Hexclave AI ask endpoint timed out"),
          name: "HexclaveAssertionError",
        }),
      });
    } finally {
      globalThis.fetch = previousFetch;
      vi.useRealTimers();
    }
  });

  it("does not expose upstream error bodies to public callers", async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response("internal stack trace", { status: 500 }));
    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("https://skill.hexclave.com/ask?question=Hello"));
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Hexclave AI is temporarily unavailable. Please try again later.");
      expect(globalVar.hexclaveCapturedErrors?.at(-1)).toMatchObject({
        location: "skill-site-ask-upstream-error",
        level: "error",
        error: expect.objectContaining({
          message: expect.stringContaining("Hexclave AI ask endpoint returned an upstream error"),
          name: "HexclaveAssertionError",
        }),
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("returns the empty-response fallback when AI content text is empty", async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "" }],
      conversationId: "conversation-123",
    })));
    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("https://skill.hexclave.com/ask?question=Hello"));
      expect(response.status).toBe(200);
      expect(await response.text()).toMatchInlineSnapshot(`
        "(empty response)

        [conversationId: conversation-123 - pass this value as the conversationId parameter in your next /ask request to continue this conversation]"
      `);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("derives the local backend from the skills port", async () => {
    const previousFetch = globalThis.fetch;
    const previousHexclaveApiUrl = process.env.NEXT_PUBLIC_HEXCLAVE_API_URL;
    delete process.env.NEXT_PUBLIC_HEXCLAVE_API_URL;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://localhost:8102/api/latest/ai/query/generate");
      return new Response(JSON.stringify({ finalText: "ok" }));
    });
    globalThis.fetch = fetchMock;

    try {
      const response = await handleAskToolRoute(new Request("http://localhost:8145/ask?question=Hello"));
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = previousFetch;
      restoreEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", previousHexclaveApiUrl);
    }
  });
});
