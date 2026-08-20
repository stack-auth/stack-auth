import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

/**
 * Fire-and-ack HTTP dispatch to the Eve app (the stateless growth agent runtime). Extracted from
 * engine.ts so the workflow-driven orchestration lib can dispatch without depending on the v1
 * engine; engine.ts keeps its own private copy until it is deleted in the migration cutover, at
 * which point this file becomes the sole implementation.
 */

// Read per call, never at module scope: the e2e suite points this at a mock server whose port is
// only known after the backend module graph has already been loaded.
function getGrowthEveBaseUrl(): string {
  return getEnvVariable("HEXCLAVE_GROWTH_EVE_URL");
}

/**
 * Like `postToEve`, but for the SYNCHRONOUS channel routes (the ones that do the work inside the
 * request instead of acking and reporting back through the agent API — /interview, /chat, and
 * /blog-draft). The timeout is far longer than the fire-and-ack one because the whole point is to
 * await generation; callers are admin-initiated requests with their own route `maxDuration`.
 *
 * The parsed JSON body is returned as `unknown` on purpose: every caller must narrow it defensively,
 * because it is produced by a separate process whose shape this module cannot type-check.
 */
export async function postToEveForResult(path: string, body: unknown, options: { timeoutMs: number }): Promise<unknown> {
  const url = getGrowthEveBaseUrl().replace(/\/+$/, "") + path;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${getEnvVariable("HEXCLAVE_GROWTH_AGENT_API_SECRET")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new HexclaveAssertionError(`Growth Eve request to ${path} failed with status ${response.status}`, { path, status: response.status, responseText: await response.text() });
  }
  return await response.json();
}

export async function postToEve(path: string, body: unknown): Promise<void> {
  // Channel routes live at the server root of the Eve app (no /eve/v1 prefix); path is a
  // code-constant with no interpolated segments, so plain concatenation is safe here.
  const url = getGrowthEveBaseUrl().replace(/\/+$/, "") + path;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${getEnvVariable("HEXCLAVE_GROWTH_AGENT_API_SECRET")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new HexclaveAssertionError(`Growth Eve dispatch to ${path} failed with status ${response.status}`, { path, status: response.status, responseText: await response.text() });
  }
}
