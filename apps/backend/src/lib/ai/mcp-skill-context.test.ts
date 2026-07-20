import { afterEach, describe, expect, it, vi } from "vitest";
import { _clearDocsCache, getMcpSkillContextPrompt, isHexclaveDocsAssistantRequest } from "./mcp-skill-context";

describe("getMcpSkillContextPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _clearDocsCache();
  });

  it("identifies Hexclave docs assistant request metadata", () => {
    expect(isHexclaveDocsAssistantRequest("skill_site_ask")).toBe(true);
    expect(isHexclaveDocsAssistantRequest("ask_hexclave")).toBe(true);
    expect(isHexclaveDocsAssistantRequest("other_tool")).toBe(false);
  });

  it("returns empty string for non-Hexclave docs assistant tool names", async () => {
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

  it("fetches and embeds the full documentation for skill-site ask requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Hexclave Docs\n\nUse Hexclave docs."),
    );

    await expect(getMcpSkillContextPrompt("skill_site_ask")).resolves.toMatchInlineSnapshot(`
      "

      ## Hexclave Documentation Context

      The current request came through the public https://skill.hexclave.com/ask endpoint.
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

  it("still fetches documentation for MCP ask_hexclave requests", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Hexclave Docs"),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).resolves.toMatchInlineSnapshot(`
      "

      ## Hexclave Documentation Context

      The current request came through the public Hexclave MCP server's ask_hexclave tool.
      The backend fetched the full Hexclave documentation from https://docs.hexclave.com/llms-full.txt
      immediately before spawning this assistant. Treat this documentation as baseline context
      for answering the user's question, while still using documentation tools for specific
      facts and citations:

      # Hexclave Docs
      "
    `);
  });

  it("throws a descriptive timeout error when the docs body stalls mid-stream", async () => {
    vi.useFakeTimers();
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
      const promptPromise = getMcpSkillContextPrompt("skill_site_ask");
      // attach the rejection expectation before advancing timers so the rejection is never unhandled
      const expectation = expect(promptPromise).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Docs fetch from https://docs.hexclave.com/llms-full.txt timed out after 5000ms]`);
      await vi.advanceTimersByTimeAsync(5_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails loudly when the documentation cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(getMcpSkillContextPrompt("skill_site_ask")).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Failed to fetch docs from https://docs.hexclave.com/llms-full.txt: 503 Service Unavailable]`);
  });

  it("throws a descriptive error when the fetch times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(getMcpSkillContextPrompt("skill_site_ask")).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Docs fetch from https://docs.hexclave.com/llms-full.txt timed out after 5000ms]`);
  });

  it("returns cached documentation on subsequent calls within TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Cached Docs"),
    );

    const first = await getMcpSkillContextPrompt("skill_site_ask");
    const second = await getMcpSkillContextPrompt("skill_site_ask");

    expect(first).toBe(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
