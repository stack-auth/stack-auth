import { afterEach, describe, expect, it, vi } from "vitest";
import { _clearDocsCache, getMcpSkillContextPrompt } from "./mcp-skill-context";

describe("getMcpSkillContextPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _clearDocsCache();
  });

  it("returns empty string for non-ask_hexclave tool names", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getMcpSkillContextPrompt("other_tool")).resolves.toMatchInlineSnapshot(`""`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty string for null toolName", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getMcpSkillContextPrompt(null)).resolves.toMatchInlineSnapshot(`""`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns empty string for undefined toolName", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getMcpSkillContextPrompt(undefined)).resolves.toMatchInlineSnapshot(`""`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and embeds the full documentation for ask_hexclave requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Hexclave Docs\n\nUse Hexclave docs."),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).resolves.toMatchInlineSnapshot(`
      "

      ## Hexclave Documentation Context

      The current request came through the public Hexclave docs assistant (the https://skill.hexclave.com/ask endpoint or the Hexclave MCP server's ask_hexclave tool).
      The backend fetched the full Hexclave documentation from https://docs.hexclave.com/llms-full.txt
      immediately before spawning this assistant. Treat this documentation as baseline context
      for answering the user's question, while still using documentation tools for specific
      facts and citations:

      # Hexclave Docs

      Use Hexclave docs.
      "
    `);
    expect(fetchSpy).toHaveBeenCalledWith("https://docs.hexclave.com/llms-full.txt", expect.objectContaining({
      headers: { Accept: "text/markdown" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("returns a sanitized error when the docs body stalls mid-stream", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Simulates real fetch behavior: headers arrive immediately, but the body stream never
    // produces data. Like undici, aborting the request signal errors the pending body read.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const stalledBody = new ReadableStream<Uint8Array>({
        start(streamController) {
          init?.signal?.addEventListener("abort", () => {
            streamController.error(new DOMException("The operation was aborted", "AbortError"));
          });
        },
      });
      return new Response(stalledBody);
    });

    try {
      const promptPromise = getMcpSkillContextPrompt("ask_hexclave");
      // attach the rejection expectation before advancing timers so the rejection is never unhandled
      const expectation = expect(promptPromise).rejects.toMatchObject({
        message: "Service Unavailable",
        name: "StatusError",
        statusCode: 503,
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes failed responses before returning a sanitized error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = new Response("missing", { status: 503, statusText: "Service Unavailable" });
    const textSpy = vi.spyOn(response, "text");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toMatchObject({
      message: "Service Unavailable",
      name: "StatusError",
      statusCode: 503,
    });
    expect(textSpy).toHaveBeenCalledOnce();
  });

  it("returns a sanitized error when the fetch times out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toMatchObject({
      message: "Service Unavailable",
      name: "StatusError",
      statusCode: 503,
    });
  });

  it("returns cached documentation on subsequent calls within TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Cached Docs"),
    );

    const first = await getMcpSkillContextPrompt("ask_hexclave");
    const second = await getMcpSkillContextPrompt("ask_hexclave");

    expect(first).toBe(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
