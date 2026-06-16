import { afterEach, describe, expect, it, vi } from "vitest";
import { getMcpSkillContextPrompt } from "./mcp-skill-context";

describe("getMcpSkillContextPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch skill context for non-ask_hexclave requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(getMcpSkillContextPrompt("other_tool")).resolves.toMatchInlineSnapshot(`""`);
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
    expect(fetchSpy).toHaveBeenCalledWith("https://skill.hexclave.com", {
      headers: { Accept: "text/markdown" },
    });
  });

  it("fails loudly when the canonical skill cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(getMcpSkillContextPrompt("ask_hexclave")).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Failed to fetch skill from https://skill.hexclave.com: 503 Service Unavailable]`,
    );
  });
});
