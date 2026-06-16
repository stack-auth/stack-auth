const HEXCLAVE_SKILL_URI = "https://skill.hexclave.com";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

let cachedSkill: { text: string, fetchedAt: number } | null = null;

async function fetchSkillText(): Promise<string> {
  const now = Date.now();
  if (cachedSkill && now - cachedSkill.fetchedAt < CACHE_TTL_MS) {
    return cachedSkill.text;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(HEXCLAVE_SKILL_URI, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Skill fetch from ${HEXCLAVE_SKILL_URI} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch skill from ${HEXCLAVE_SKILL_URI}: ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  cachedSkill = { text, fetchedAt: now };
  return text;
}

export async function getMcpSkillContextPrompt(toolName: string | null | undefined): Promise<string> {
  if (toolName !== "ask_hexclave") {
    return "";
  }

  const skillContext = await fetchSkillText();
  return `

## MCP-Provided Hexclave Skill Context

The current request came through the public Hexclave MCP server's ask_hexclave tool.
The backend fetched the canonical Hexclave agent skill from https://skill.hexclave.com
immediately before spawning this assistant. Treat this skill content as baseline context
for answering the user's question, while still using documentation tools for specific
facts and citations:

${skillContext}
`;
}

/**
 * Exposed for testing only — clears the module-level skill cache.
 */
export function _clearSkillCache(): void {
  cachedSkill = null;
}
