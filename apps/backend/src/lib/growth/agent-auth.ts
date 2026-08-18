import { getSoleTenancyFromProjectBranch, Tenancy } from "@/lib/tenancies";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { createHash, timingSafeEqual } from "node:crypto";
import { requireGrowthAppEnabled } from "./dashboard";
import {
  authenticateGrowthRunToken,
  type GrowthRunTokenCapability,
  type GrowthRunTokenClaims,
  isGrowthRunToken,
  shouldLogGrowthRunTokenRejection,
} from "./run-token";

/**
 * Constant-time comparison of the Authorization header against the expected `Bearer <secret>`
 * value. We hash both sides with SHA-256 first because timingSafeEqual requires equal-length
 * buffers — hashing makes the lengths match without leaking the secret's length through an early
 * length-mismatch return.
 */
export function checkGrowthAgentSecret(authorizationHeader: string | undefined, secret: string): boolean {
  if (authorizationHeader == null) {
    return false;
  }
  const providedDigest = createHash("sha256").update(authorizationHeader).digest();
  const expectedDigest = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

// Every rejection on every path below throws exactly this, so a caller learns only "not authorized"
// — never which of the two credentials it presented, nor which of the run token's dozen rejection
// reasons applied. See GrowthRunTokenRejection's doc comment in run-token.ts.
const GROWTH_AGENT_UNAUTHORIZED_MESSAGE = "Unauthorized";

/**
 * The bearer value, or null when the header is absent or is not a `Bearer ` header at all.
 *
 * This exists so that ONE predicate — `isGrowthRunToken` applied to the result — decides both
 * whether to run the run-token path and whether to run the shared-secret comparison. Two
 * independent decisions could disagree (a value that looks enough like a token to be sent down the
 * crypto path but is still compared against the secret, or vice versa); one predicate cannot.
 * Mirrors `getWorkflowRunTokenForRequest`'s syntactic-routing-before-crypto rule.
 */
function readBearerValue(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader == null) return null;
  const scheme = "Bearer ";
  if (!authorizationHeader.startsWith(scheme)) return null;
  return authorizationHeader.slice(scheme.length);
}

/**
 * The run-token half of both entry points below. Resolves the tenancy first (the token's own
 * `tenancy_id` claim is checked against it, which is what closes the project-binding loop) and
 * collapses every failure into one bare 401.
 */
async function authenticateGrowthRunTokenOrThrow(options: {
  token: string,
  projectId: string,
  branchId: string,
  requireCapability: GrowthRunTokenCapability,
}): Promise<{ tenancy: Tenancy, claims: GrowthRunTokenClaims }> {
  // A (projectId, branchId) that resolves to no tenancy is an AUTHENTICATION failure here, not the
  // 404 the shared-secret path returns: that path only reaches the lookup after proving it holds the
  // secret, whereas this one is reachable by anyone, and a 404-vs-401 split would make it a free
  // probe for which projects and branches exist. `tenancy-not-found` is a member of the run token's
  // rejection union for exactly this reason, and is classified as unauthenticated-reachable, i.e.
  // not worth a log line.
  const tenancy = await getSoleTenancyFromProjectBranch(options.projectId, options.branchId, true);
  if (tenancy == null) {
    throw new StatusError(401, GROWTH_AGENT_UNAUTHORIZED_MESSAGE);
  }
  const result = await authenticateGrowthRunToken({
    token: options.token,
    projectId: options.projectId,
    branchId: options.branchId,
    tenancyId: tenancy.id,
    requireCapability: options.requireCapability,
  });
  if (result.status === "error") {
    // Logged only when the rejection was unreachable without a genuine backend-minted signature —
    // a reaped phase's session still calling out, a superseded attempt, a session asking for a
    // capability its kind does not carry. The reason NEVER reaches the response.
    if (shouldLogGrowthRunTokenRejection(result.error)) {
      console.log(`[Growth run token] Rejected an authentic run token for project ${options.projectId}: ${result.error}`);
    }
    throw new StatusError(401, GROWTH_AGENT_UNAUTHORIZED_MESSAGE);
  }
  requireGrowthAppEnabled(tenancy);
  return { tenancy, claims: result.data };
}

/**
 * Authenticates a request from the growth agent (Eve) and resolves the tenancy it is acting on.
 *
 * TWO credentials are accepted here, and this is deliberately not a flag day:
 *  - the shared machine secret (HEXCLAVE_GROWTH_AGENT_API_SECRET), which is valid for every project
 *    at once;
 *  - a run-scoped token (run-token.ts) carrying the `growth_agent_api` capability, bound to one
 *    project, one branch, one dispatched session and one short window.
 *
 * WHAT THE RUN TOKEN BUYS ON THIS ROUTE TREE — stated precisely, because the mitigation invites
 * over-claiming: nothing, on its own. A leaked shared secret still reads and writes every project's
 * growth rows through these 24 routes, exactly as before. What it can no longer do is obtain a Meta
 * credential: the vending route (internal/growth-agent/ads/mcp-token) authenticates with
 * `authenticateGrowthAgentRunRequest` below, which rejects the shared secret outright, so spend-
 * capable material is reachable only by a session the backend itself dispatched. Narrowing THESE
 * routes to run tokens only is a separate, later change; it would break the shared-secret callers
 * that still exist (apps/growth-agent/agent/lib/hexclave-client.ts) and buys much less.
 */
export async function authenticateGrowthAgentRequest(options: {
  authorizationHeader: string | undefined,
  projectId: string,
  branchId: string,
}): Promise<Tenancy> {
  const bearerValue = readBearerValue(options.authorizationHeader);
  if (isGrowthRunToken(bearerValue)) {
    const { tenancy } = await authenticateGrowthRunTokenOrThrow({
      token: bearerValue,
      projectId: options.projectId,
      branchId: options.branchId,
      requireCapability: "growth_agent_api",
    });
    return tenancy;
  }
  // getEnvVariable throws on unset/empty, so a misconfigured deployment fails loudly (500) instead
  // of comparing against an empty secret.
  const secret = getEnvVariable("HEXCLAVE_GROWTH_AGENT_API_SECRET");
  if (!checkGrowthAgentSecret(options.authorizationHeader, secret)) {
    throw new StatusError(401, GROWTH_AGENT_UNAUTHORIZED_MESSAGE);
  }
  const tenancy = await getSoleTenancyFromProjectBranch(options.projectId, options.branchId, true);
  if (tenancy == null) {
    throw new StatusError(404, "Project or branch not found.");
  }
  requireGrowthAppEnabled(tenancy);
  return tenancy;
}

/**
 * Authenticates a request that a RUN TOKEN alone may make, and returns the token's claims alongside
 * the tenancy so the route can scope its work to the session's anchor.
 *
 * The shared machine secret is rejected here with the same bare 401 as a forged token — no
 * distinguishing message, because a caller holding the secret learning "wrong credential type" tells
 * it exactly which credential to go and steal instead. This is the boundary that keeps a leaked
 * shared secret away from ad-platform credentials; see `authenticateGrowthAgentRequest` above.
 */
export async function authenticateGrowthAgentRunRequest(options: {
  authorizationHeader: string | undefined,
  projectId: string,
  branchId: string,
  requireCapability: GrowthRunTokenCapability,
}): Promise<{ tenancy: Tenancy, claims: GrowthRunTokenClaims }> {
  const bearerValue = readBearerValue(options.authorizationHeader);
  if (!isGrowthRunToken(bearerValue)) {
    throw new StatusError(401, GROWTH_AGENT_UNAUTHORIZED_MESSAGE);
  }
  return await authenticateGrowthRunTokenOrThrow({
    token: bearerValue,
    projectId: options.projectId,
    branchId: options.branchId,
    requireCapability: options.requireCapability,
  });
}
