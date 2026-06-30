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

      ## MCP-Provided Hexclave Documentation Context

      The current request came through the public Hexclave MCP server's ask_hexclave tool.
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

  it("fails loudly when the documentation cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Failed to fetch docs from https://docs.hexclave.com/llms-full.txt: 503 Service Unavailable]`);
  });

  it("throws a descriptive error when the fetch times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: Docs fetch from https://docs.hexclave.com/llms-full.txt timed out after 5000ms]`);
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
