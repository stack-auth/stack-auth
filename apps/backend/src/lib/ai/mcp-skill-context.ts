import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

const HEXCLAVE_DOCS_FULL_URL = "https://docs.hexclave.com/llms-full.txt";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

let cachedDocs: { text: string, fetchedAt: number } | null = null;

async function fetchDocsText(): Promise<string> {
  const now = performance.now();
  if (cachedDocs && now - cachedDocs.fetchedAt < CACHE_TTL_MS) {
    return cachedDocs.text;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // The timeout must stay armed until the body is fully consumed, not just until the headers
  // arrive: `fetch` resolves as soon as headers are received, so a CDN that stalls mid-body
  // would otherwise hang this request forever. Aborting the signal also errors the pending
  // `response.text()` read, which the catch below classifies as a timeout.
  try {
    const response = await fetch(HEXCLAVE_DOCS_FULL_URL, {
      headers: { Accept: "text/markdown" },
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.text();
      throw new Error(
        `Failed to fetch docs from ${HEXCLAVE_DOCS_FULL_URL}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    cachedDocs = { text, fetchedAt: now };
    return text;
  } catch (err: unknown) {
    // `controller.signal.aborted` is checked in addition to the DOMException, because some
    // fetch implementations surface aborted-mid-body reads as other error types (e.g.
    // undici's "terminated" TypeError) — if our timeout fired, it's a timeout either way.
    if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new Error(`Docs fetch from ${HEXCLAVE_DOCS_FULL_URL} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getMcpSkillContextPrompt(toolName: string | null | undefined): Promise<string> {
  // Both the public https://skill.hexclave.com/ask endpoint and the Hexclave MCP server's
  // ask_hexclave tool report the same tool name, since they are the same docs assistant
  // exposed through two transports.
  if (toolName !== "ask_hexclave") {
    return "";
  }

  let docsContext: string;
  try {
    docsContext = await fetchDocsText();
  } catch (error: unknown) {
    captureError("mcp-skill-context-docs-fetch", error);
    throw new StatusError(StatusError.ServiceUnavailable);
  }

  return `

## Hexclave Documentation Context

The current request came through the public Hexclave docs assistant (the https://skill.hexclave.com/ask endpoint or the Hexclave MCP server's ask_hexclave tool).
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
