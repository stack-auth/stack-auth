import { createHash, timingSafeEqual } from "node:crypto";
import { extractBearerToken } from "eve/channels/auth";

/**
 * Result of verifying the inbound service-to-service bearer token. On
 * failure, `response` is the 401 the channel route should return verbatim —
 * it intentionally carries no detail about which check failed so a probing
 * caller cannot distinguish a missing header from a wrong secret.
 */
export type GrowthAgentBearerVerification =
  | { readonly ok: true }
  | { readonly ok: false, readonly response: Response };

/**
 * Verifies that `request` carries `Authorization: Bearer <secret>` matching
 * HEXCLAVE_GROWTH_AGENT_API_SECRET. A missing/empty secret env var is a
 * deployment misconfiguration, not a caller error, so it throws instead of
 * returning 401 — failing loud beats silently rejecting all traffic.
 */
export function verifyGrowthAgentBearer(request: Request): GrowthAgentBearerVerification {
  const secret = process.env.HEXCLAVE_GROWTH_AGENT_API_SECRET;
  if (secret == null || secret.length === 0) {
    throw new Error("HEXCLAVE_GROWTH_AGENT_API_SECRET is not set; the growth agent cannot authenticate inbound backend requests without it");
  }
  const token = extractBearerToken(request.headers.get("authorization"));
  if (token == null || !timingSafeStringEqual(token, secret)) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, {
        status: 401,
        headers: { "www-authenticate": "Bearer" },
      }),
    };
  }
  return { ok: true };
}

// Comparing SHA-256 digests (instead of the raw strings) lets us use
// timingSafeEqual on equal-length buffers without leaking the secret's length
// through an early length-mismatch return.
function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
