const HEXCLAVE_DOCS_FULL_URL = "https://docs.hexclave.com/llms-full.txt";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

let cachedDocs: { text: string, fetchedAt: number } | null = null;

export function isHexclaveDocsAssistantRequest(toolName: string | null | undefined): boolean {
  return toolName === "skill_site_ask" || toolName === "ask_hexclave";
}

async function fetchDocsText(): Promise<string> {
  const now = performance.now();
  if (cachedDocs && now - cachedDocs.fetchedAt < CACHE_TTL_MS) {
    return cachedDocs.text;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(HEXCLAVE_DOCS_FULL_URL, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Docs fetch from ${HEXCLAVE_DOCS_FULL_URL} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch docs from ${HEXCLAVE_DOCS_FULL_URL}: ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  cachedDocs = { text, fetchedAt: now };
  return text;
}

export async function getMcpSkillContextPrompt(toolName: string | null | undefined): Promise<string> {
  if (!isHexclaveDocsAssistantRequest(toolName)) {
    return "";
  }

  const docsContext = await fetchDocsText();
  const requestSource = toolName === "skill_site_ask"
    ? "the public https://skill.hexclave.com/ask endpoint"
    : "the public Hexclave MCP server's ask_hexclave tool";

  return `

## Hexclave Documentation Context

The current request came through ${requestSource}.
The backend fetched the full Hexclave documentation from https://docs.hexclave.com/llms-full.txt
immediately before spawning this assistant. Treat this documentation as baseline context
for answering the user's question, while still using documentation tools for specific
facts and citations:

${docsContext}
`;
}

/**
 * Exposed for testing only — clears the module-level docs cache.
 */
export function _clearDocsCache(): void {
  cachedDocs = null;
}
