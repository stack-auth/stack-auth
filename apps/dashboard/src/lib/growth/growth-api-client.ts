import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import { z } from "zod";

/**
 * The shared HTTP layer behind every `/internal/growth/**` call the dashboard makes.
 *
 * Split out of growth-api.ts so the growth surfaces that have their own fetcher module (today the
 * Games section's growth-games-api.ts) can reuse the error conversion and the header quirk below
 * without importing a 1,100-line module — and, more importantly, without each growing its own
 * subtly different copy of them. growth-api.ts re-exports GrowthApiError and toGrowthApiError so
 * existing importers are unaffected.
 */

export class GrowthApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "GrowthApiError";
  }
}

// Growth reads a project's own workspace through that project's owned-project admin app: the app is
// constructed with `tokenStore === null`, so the admin key is its only authorization and every
// request goes out as an admin request with the project implied by the key.
// The SDK's request plumbing THROWS on 4xx responses instead of returning them (see
// sendClientRequestInner in packages/shared/src/interface/client-interface.ts: known errors are
// thrown as KnownError instances, other 4xx as `new Error("Failed to send request to <url>: <status>
// <body>", { cause: response })`). Without this conversion, GrowthApiError-based handling (e.g. the
// settings page's friendly 409 "already running" alert) never triggers, and the raw message —
// including the internal URL — leaks into user-facing alerts.
const MAX_ERROR_MESSAGE_LENGTH = 400;

export function readGrowthErrorMessage(bodyText: string, fallback: string): string {
  const text = bodyText.trim();
  if (text.length === 0 || text.length > MAX_ERROR_MESSAGE_LENGTH) return fallback;
  if (text.startsWith("{")) {
    try {
      const body = z.object({ error: z.string().optional() }).passthrough().parse(JSON.parse(text));
      return body.error ?? fallback;
    } catch {
      return fallback;
    }
  }
  if (text.startsWith("<")) return fallback;
  return text;
}

export function toGrowthApiError(error: unknown): GrowthApiError | null {
  if (!(error instanceof Error)) {
    return null;
  }
  // KnownError extends StatusError, which carries statusCode + a human-readable message.
  if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
    return new GrowthApiError(error.statusCode, error.message);
  }
  const cause = error.cause;
  if (cause instanceof Response && cause.status >= 400 && cause.status < 500) {
    // The response body was already consumed by the SDK, but it embedded the text into the message
    // after the `: <status> ` token — recover the route's safe `{ error }` string from there.
    const fallback = `Growth request failed with status ${cause.status}`;
    const marker = `: ${cause.status} `;
    const markerIndex = error.message.indexOf(marker);
    return new GrowthApiError(cause.status, markerIndex < 0 ? fallback : readGrowthErrorMessage(error.message.slice(markerIndex + marker.length), fallback));
  }
  return null;
}

/**
 * Request headers for a growth call. `content-type: application/json` is declared ONLY when there is
 * a body, and that condition is load-bearing rather than tidiness.
 *
 * Declaring it on a bodyless POST (retry, skip, retake, activate, dismiss, mark-read) makes the
 * backend try to parse "" as JSON, so the request dies with a 400 BODY_PARSING_ERROR before it ever
 * reaches auth or the handler. Worse, that particular error is unreadable to the client: the SDK's
 * BodyParsingError pulls its message out of `json.details`, which the backend's `{code, error}` body
 * does not carry, so the failure surfaces as "TypeError: Cannot read properties of undefined
 * (reading 'message')" — no status, no hint, and identical for every affected button.
 *
 * Exported for the regression test; not part of the module's API otherwise.
 */
export function growthRequestHeaders(init: RequestInit): Record<string, string> {
  return { ...init.body == null ? {} : { "content-type": "application/json" }, ...init.headers as Record<string, string> | undefined };
}

export async function requestJson(app: object, path: string, init: RequestInit = {}): Promise<unknown> {
  let response;
  try {
    response = await sendInternalAdminRequest(app, `/internal/growth${path}`, { ...init, headers: growthRequestHeaders(init) });
  } catch (error) {
    throw toGrowthApiError(error) ?? error;
  }
  const text = await response.text();
  if (!response.ok) {
    // Defensive: with the current SDK, 4xx never reaches here (it throws above) — but 5xx and any
    // future SDK behavior change land in this branch.
    throw new GrowthApiError(response.status, readGrowthErrorMessage(text, `Growth request failed with status ${response.status}`));
  }
  return text.length === 0 ? {} : JSON.parse(text);
}
