import { afterEach, describe, expect, it, vi } from "vitest";
import { _clearSkillCache, getMcpSkillContextPrompt } from "./mcp-skill-context";

describe("getMcpSkillContextPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _clearSkillCache();
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

  it("fetches and embeds the canonical skill for ask_hexclave requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Hexclave Skill\n\nUse Hexclave docs."),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).resolves.toMatchInlineSnapshot(`
      "

      ## MCP-Provided Hexclave Skill Context

      The current request came through the public Hexclave MCP server's ask_hexclave tool.
      The backend fetched the canonical Hexclave agent skill from https://skill.hexclave.com
      immediately before spawning this assistant. Treat this skill content as baseline context
      for answering the user's question, while still using documentation tools for specific
      facts and citations:

      # Hexclave Skill

      Use Hexclave docs.
      "
    `);
    expect(fetchSpy).toHaveBeenCalledWith("https://skill.hexclave.com", expect.objectContaining({
      headers: { Accept: "text/markdown" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("fails loudly when the canonical skill cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Failed to fetch skill from https://skill.hexclave.com: 503 Service Unavailable]`,
    );
  });

  it("throws a descriptive error when the fetch times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const err = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(err);
    });

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Skill fetch from https://skill.hexclave.com timed out after 5000ms]`,
    );
  });

  it("returns cached skill on subsequent calls within TTL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("# Cached Skill"),
    );

    const first = await getMcpSkillContextPrompt("ask_hexclave");
    const second = await getMcpSkillContextPrompt("ask_hexclave");

    expect(first).toBe(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
