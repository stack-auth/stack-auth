import { GrowthPhaseStatus } from "@/generated/prisma/enums";
import { globalPrismaClient } from "@/prisma-client";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { signJWT, verifyJWT } from "@hexclave/shared/dist/utils/jwt";
import { Result } from "@hexclave/shared/dist/utils/results";
import * as jose from "jose";
import { JOSEError } from "jose/errors";
import { GROWTH_ACTIVE_RUN_STATUSES } from "./phases";

// The bearer credential ONE dispatched growth agent session uses to call back
// into the internal growth-agent API — and, from PART VI onwards, to ask the
// backend to vend a Meta Ads access token for the project it is analyzing.
//
// Modelled line-for-line on lib/workflows/run-token.tsx; read that file first,
// the reasoning below only records where growth differs.
//
// WHY IT EXISTS. Growth agent sessions authenticate today with a single shared
// machine secret (HEXCLAVE_GROWTH_AGENT_API_SECRET) that is valid for every
// project at once. That was tolerable while the agent could only read and write
// growth rows. It stops being tolerable the moment a session can obtain a
// customer's Meta credential, because a leaked shared secret would then be able
// to spend any customer's ad budget directly against graph.facebook.com. A run
// token is bound to one project, one branch, one dispatched session, and one
// short window, so the credential-vending route can refuse everything else.
//
// SECURITY MODEL — every one of these properties is load-bearing:
//   * Signed with the per-audience key derived from HEXCLAVE_SERVER_SECRET, on a
//     `growth-agent-run:<projectId>` audience. Because `getPrivateJwks` derives
//     the key from the audience string, a token minted for one project is not
//     merely rejected by a check — it is signed with a DIFFERENT key than any
//     other project's, and than any user access token. Rewriting `aud` to a
//     victim project therefore breaks the signature rather than granting access.
//     The audience puts the constant FIRST on purpose: `decodeAccessToken`
//     parses an access-token audience positionally as `aud.split(":")[0]`, so a
//     `<projectId>:growth-agent-run` audience would yield a real project id
//     there and leave `iss` as the only thing separating this credential from an
//     end-user one. With the constant first, that parse produces a non-existent
//     project and a replay fails for two independent reasons instead of one.
//   * Bound to (project, branch, tenancy, session kind, dispatch anchor), and —
//     for the kinds that have one — to the anchor's `attempt`. The attempt is a
//     genuine fencing token: `claimAndDispatchPhase` CASes an increment on every
//     dispatch and `reapStuckPhasesForRun` resets a silent phase to PENDING, so
//     a reaped-and-redispatched phase's old token stops authenticating the
//     moment the new attempt lands. That is what stops a zombie session, still
//     running somewhere, from vending a Meta token for work we abandoned.
//   * Checked against live anchor state on every request, so cancelling a run or
//     finishing a brief takes effect immediately for the in-flight session.
//   * Short-lived regardless (see the TTL table below), so a leaked token dies
//     on its own even if the anchor never settles.
//   * Carries a CLOSED set of capabilities derived from the session kind, never
//     supplied by a caller. There is deliberately no capability that grants
//     activating an ad or changing its budget — no code path can produce one.
//
// RESIDUAL RISK THAT THIS DOES *NOT* REMOVE — say it plainly, because the shape
// of the mitigation invites over-claiming: once a session's token has been
// exchanged for a Meta access token, the agent process holds a FULL-POWER,
// non-attenuable Meta credential in memory for the rest of that session. Meta
// has no mechanism to mint a read-only or spend-capped derivative of it, and the
// tool allow-list that keeps the model away from activation lives in the agent,
// i.e. on the far side of the trust boundary. What run-scoped tokens buy is a
// much smaller window (minutes, one project, one dispatched session), a hard
// stop the moment the anchor is reaped or cancelled, and an auditable record of
// exactly which session asked for a credential and when. They shrink and
// illuminate the exposure; they do not close it.
//
// SHARDING: these reads run against the global Prisma client, where the growth
// tables live today — same note as lib/workflows/run-token.tsx.

/**
 * Distinguishes a run token from the shared growth agent secret in the
 * Authorization header. The secret is operator-supplied, so this prefix is a
 * convention rather than a construction-proof discriminator (unlike API keys);
 * see `isGrowthRunToken` for what that costs.
 */
export const GROWTH_RUN_TOKEN_PREFIX = "grt_";

// Internal-only: nothing outside this backend ever verifies a growth run token,
// so the issuer does not need to encode a host (and deliberately does not).
const GROWTH_RUN_TOKEN_ISSUER = "hexclave-growth-orchestrator";
const GROWTH_RUN_TOKEN_TYPE = "growth_agent_run";

function getGrowthRunTokenAudience(projectId: string): string {
  return `growth-agent-run:${projectId}`;
}

/**
 * The kinds of dispatched session that get a token. Each kind fixes its
 * capabilities, its TTL, and which live row (if any) has to still be active for
 * the token to authenticate.
 */
export const GROWTH_RUN_TOKEN_SESSION_KINDS = ["analysis_phase", "daily_brief", "interview_turn", "chat_turn"] as const;
export type GrowthRunTokenSessionKind = typeof GROWTH_RUN_TOKEN_SESSION_KINDS[number];

/**
 * The CLOSED capability set. Adding an entry here is the only way to widen what
 * any growth session can ask the backend to do on an external platform, which is
 * exactly why it is a hand-written list rather than a free-form string:
 *
 *  - `growth_agent_api` — the existing internal/growth-agent/** routes (growth
 *    rows only, no external side effects).
 *
 * A single-entry set today: this build has no ad platform integration, so no
 * growth session can reach an external platform at all. The ad-platform
 * capabilities (exchanging this token for a platform access token, and the
 * build-capable variant minted only for an admin-initiated execution session)
 * land with that integration. Whatever is added here must keep the property this
 * list exists to enforce: there is no capability for activating an entity or
 * changing a budget — that transition belongs exclusively to an
 * admin-authenticated route, never to anything an agent session can hold.
 */
export const GROWTH_RUN_TOKEN_CAPABILITIES = ["growth_agent_api"] as const;
export type GrowthRunTokenCapability = typeof GROWTH_RUN_TOKEN_CAPABILITIES[number];

/**
 * Capabilities are derived from the session kind here, never passed in by a
 * dispatch site. A mint helper that accepted a caps array would be one careless
 * call away from an over-granted token, and the grant table is the whole point
 * of the credential.
 *
 * Every kind maps to the same single capability while the capability set has only
 * one entry; the map is kept (rather than collapsed) because it is the seam where
 * per-kind grants are expressed, and the ad-platform capabilities differ by kind
 * the moment they exist.
 */
const GROWTH_RUN_TOKEN_CAPABILITIES_BY_KIND: ReadonlyMap<GrowthRunTokenSessionKind, readonly GrowthRunTokenCapability[]> = new Map([
  ["analysis_phase", ["growth_agent_api"]],
  ["daily_brief", ["growth_agent_api"]],
  ["interview_turn", ["growth_agent_api"]],
  ["chat_turn", ["growth_agent_api"]],
] satisfies [GrowthRunTokenSessionKind, readonly GrowthRunTokenCapability[]][]);

/**
 * TTLs are derived from the session kind for the same reason capabilities are:
 * a caller-supplied lifetime is a caller-supplied security parameter.
 *
 * The long-session value mirrors MAX_AGENT_SESSION_MS in
 * apps/growth-agent/agent/lib/run-analysis-phase.ts (45 min) plus 5 min of
 * dispatch and startup slack; the turn values mirror the 120 s turn timeouts in
 * chat.ts / interview.ts plus 60 s. They are duplicated rather than imported
 * because the backend does not depend on the agent app's module graph — if the
 * agent-side timeout grows past these, sessions start failing authentication
 * near their end, which is a loud failure rather than a silent one.
 */
const GROWTH_RUN_TOKEN_TTL_MS_BY_KIND: ReadonlyMap<GrowthRunTokenSessionKind, number> = new Map([
  ["analysis_phase", 50 * 60 * 1000],
  ["daily_brief", 50 * 60 * 1000],
  ["interview_turn", 3 * 60 * 1000],
  ["chat_turn", 3 * 60 * 1000],
] satisfies [GrowthRunTokenSessionKind, number][]);

/**
 * What the token was minted for. The `sub` claim carries the dispatch anchor's
 * id, which for an analysis phase is the GrowthAnalysisPhase row (the run and
 * phase key are separate claims because they are the lookup coordinates) and for
 * every other kind is the id already named in the variant.
 */
export type GrowthRunTokenSession =
  | { sessionKind: "analysis_phase", phaseId: string, runId: string, phaseKey: string, attempt: number }
  | { sessionKind: "daily_brief", briefId: string }
  | { sessionKind: "interview_turn", runId: string }
  | { sessionKind: "chat_turn", turnId: string };

export type GrowthRunTokenClaims = GrowthRunTokenSession & {
  tenancyId: string,
  branchId: string,
  caps: readonly GrowthRunTokenCapability[],
};

/**
 * Why a token was rejected. Kept as a closed union so the auth path can log the
 * specific reason while returning ONE bare 401 with a byte-identical body —
 * these strings must never reach an API response, since they would tell an
 * unauthenticated prober which runs, briefs and phases exist and what state
 * they are in.
 */
export type GrowthRunTokenRejection =
  | "not-a-run-token"
  | "unparsable"
  | "audience-mismatch"
  | "signature-or-expiry-invalid"
  | "issuer-mismatch"
  | "wrong-token-type"
  | "malformed-claims"
  | "tenancy-not-found"
  | "branch-mismatch"
  | "tenancy-mismatch"
  | "anchor-not-found"
  | "anchor-not-active"
  | "attempt-superseded"
  | "capability-missing";

/**
 * Rejections reachable by any unauthenticated caller who knows a project id
 * (which is semi-public): purely syntactic failures, forged/expired signatures,
 * and a (projectId, branchId) that resolves to no tenancy. None of them prove
 * the caller ever held a real token, so logging them would be a free log-spam
 * primitive that tells us nothing. Everything else got PAST signature
 * verification, i.e. a genuine backend-minted token was rejected — always worth
 * a line (a reaped phase's session still calling out, a superseded attempt, a
 * session asking for a capability its kind does not carry).
 */
const UNAUTHENTICATED_REACHABLE_REJECTIONS: readonly GrowthRunTokenRejection[] = ["not-a-run-token", "unparsable", "audience-mismatch", "signature-or-expiry-invalid", "tenancy-not-found"];

export function shouldLogGrowthRunTokenRejection(rejection: GrowthRunTokenRejection): boolean {
  return !UNAUTHENTICATED_REACHABLE_REJECTIONS.includes(rejection);
}

/**
 * Cheap syntactic check so the auth path can route an Authorization header
 * without doing crypto.
 *
 * Unlike API keys, the thing this has to be distinguished from — the shared
 * growth agent secret — is chosen by the operator, so a secret that happened to
 * start with `grt_` would be routed down the token path and rejected. That is a
 * fail-CLOSED misconfiguration (the deployment's growth agent stops working
 * loudly), not a bypass, which is why a convention is acceptable here.
 */
export function isGrowthRunToken(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(GROWTH_RUN_TOKEN_PREFIX);
}

function getSessionAnchorId(session: GrowthRunTokenSession): string {
  switch (session.sessionKind) {
    case "analysis_phase": { return session.phaseId; }
    case "daily_brief": { return session.briefId; }
    case "interview_turn": { return session.runId; }
    case "chat_turn": { return session.turnId; }
  }
}

/**
 * Mints the token a dispatch site puts in the session's dispatch BODY (never a
 * header — the channel hop is separately authenticated by the shared secret, and
 * mixing the two would change what the e2e mock captures as the hop's
 * authorization).
 */
export async function createGrowthRunToken(options: {
  projectId: string,
  branchId: string,
  tenancyId: string,
  session: GrowthRunTokenSession,
}): Promise<string> {
  const session = options.session;
  const expiresInMs = GROWTH_RUN_TOKEN_TTL_MS_BY_KIND.get(session.sessionKind)
    ?? throwErr(`No growth run token TTL is registered for session kind "${session.sessionKind}"`, { sessionKind: session.sessionKind });
  const caps = GROWTH_RUN_TOKEN_CAPABILITIES_BY_KIND.get(session.sessionKind)
    ?? throwErr(`No growth run token capabilities are registered for session kind "${session.sessionKind}"`, { sessionKind: session.sessionKind });
  // The TTLs above are constants, so this can only fire after someone edits one
  // into a value that mints an already-dead token (or makes jose throw deep
  // inside signing). Fail loudly rather than produce one.
  if (!Number.isFinite(expiresInMs) || expiresInMs < 1000) {
    throwErr("Growth run token TTL must be a finite duration of at least one second", { sessionKind: session.sessionKind, expiresInMs });
  }
  const jwt = await signJWT({
    issuer: GROWTH_RUN_TOKEN_ISSUER,
    audience: getGrowthRunTokenAudience(options.projectId),
    expirationTime: `${Math.floor(expiresInMs / 1000)}s`,
    payload: {
      token_type: GROWTH_RUN_TOKEN_TYPE,
      sub: getSessionAnchorId(session),
      tenancy_id: options.tenancyId,
      branch_id: options.branchId,
      session_kind: session.sessionKind,
      caps,
      // Kind-specific coordinates. The named claim is emitted even when it
      // duplicates `sub` so a reader of the payload never has to know the
      // per-kind `sub` encoding; verification asserts the two agree.
      ...session.sessionKind === "analysis_phase" ? { run_id: session.runId, phase_key: session.phaseKey, attempt: session.attempt } : {},
      ...session.sessionKind === "daily_brief" ? { brief_id: session.briefId } : {},
      ...session.sessionKind === "interview_turn" ? { run_id: session.runId } : {},
      ...session.sessionKind === "chat_turn" ? { turn_id: session.turnId } : {},
    },
  });
  return GROWTH_RUN_TOKEN_PREFIX + jwt;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSessionKind(value: unknown): value is GrowthRunTokenSessionKind {
  return typeof value === "string" && (GROWTH_RUN_TOKEN_SESSION_KINDS as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is GrowthRunTokenCapability {
  return typeof value === "string" && (GROWTH_RUN_TOKEN_CAPABILITIES as readonly string[]).includes(value);
}

function isAttempt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Parses the kind-specific half of a VERIFIED payload. Checked field by field
 * (rather than by iterating an assembled object) so that adding an optional
 * claim later cannot silently make it required, and so the result narrows
 * without a cast.
 */
function parseSession(payload: jose.JWTPayload, anchorId: string): GrowthRunTokenSession | null {
  const sessionKind = payload.session_kind;
  if (!isSessionKind(sessionKind)) return null;
  const { run_id: runId, phase_key: phaseKey, attempt, brief_id: briefId, turn_id: turnId } = payload;
  switch (sessionKind) {
    case "analysis_phase": {
      if (!isNonEmptyString(runId) || !isNonEmptyString(phaseKey) || !isAttempt(attempt)) return null;
      return { sessionKind, phaseId: anchorId, runId, phaseKey, attempt };
    }
    case "daily_brief": {
      if (!isNonEmptyString(briefId) || briefId !== anchorId) return null;
      return { sessionKind, briefId };
    }
    case "interview_turn": {
      if (!isNonEmptyString(runId) || runId !== anchorId) return null;
      return { sessionKind, runId };
    }
    case "chat_turn": {
      if (!isNonEmptyString(turnId) || turnId !== anchorId) return null;
      return { sessionKind, turnId };
    }
  }
}

/**
 * Verifies signature, expiry, issuer, audience and claim shape. Does NOT consult
 * the database, so on its own it is NOT sufficient to authenticate a request —
 * {@link authenticateGrowthRunToken} is the entry point. Exported separately so
 * the cryptographic half can be unit-tested without a DB.
 */
export async function verifyGrowthRunTokenClaims(token: string, options: {
  projectId: string,
}): Promise<Result<GrowthRunTokenClaims, GrowthRunTokenRejection>> {
  if (!isGrowthRunToken(token)) return Result.error("not-a-run-token");
  const jwt = token.slice(GROWTH_RUN_TOKEN_PREFIX.length);
  const expectedAudience = getGrowthRunTokenAudience(options.projectId);

  // `verifyJWT` picks its key set from the token's OWN `aud` claim, so the
  // audience must be pinned to the project in the request BEFORE verifying.
  // Skipping this would let an attacker-supplied `aud` choose which key the
  // signature is checked against, which is the whole ballgame.
  let unverified: jose.JWTPayload;
  try {
    unverified = jose.decodeJwt(jwt);
  } catch (error) {
    if (error instanceof JOSEError) return Result.error("unparsable");
    throw error;
  }
  // Strict equality also rejects an `aud` supplied as an array, which is legal
  // JWT but which `verifyJWT` cannot handle either.
  if (unverified.aud !== expectedAudience) return Result.error("audience-mismatch");

  let payload: jose.JWTPayload;
  try {
    payload = await verifyJWT({ allowedIssuers: [GROWTH_RUN_TOKEN_ISSUER], jwt });
  } catch (error) {
    // Only JOSE-level failures are authentication failures (bad signature,
    // expired, disallowed issuer). Anything else — notably the assertion
    // `getPrivateJwks` throws when HEXCLAVE_SERVER_SECRET is missing or
    // malformed — is a server fault and must surface loudly instead of being
    // laundered into "invalid credential" for every growth session in the fleet.
    if (error instanceof JOSEError) return Result.error("signature-or-expiry-invalid");
    throw error;
  }

  // Re-assert against the VERIFIED payload rather than trusting the earlier read
  // of the unverified one.
  if (payload.aud !== expectedAudience) return Result.error("audience-mismatch");
  if (payload.iss !== GROWTH_RUN_TOKEN_ISSUER) return Result.error("issuer-mismatch");
  if (payload.token_type !== GROWTH_RUN_TOKEN_TYPE) return Result.error("wrong-token-type");

  const { sub, tenancy_id: tenancyId, branch_id: branchId, caps } = payload;
  if (!isNonEmptyString(sub)) return Result.error("malformed-claims");
  if (!isNonEmptyString(tenancyId)) return Result.error("malformed-claims");
  if (!isNonEmptyString(branchId)) return Result.error("malformed-claims");
  if (!Array.isArray(caps) || caps.length === 0 || !caps.every(isCapability)) return Result.error("malformed-claims");

  const session = parseSession(payload, sub);
  if (session == null) return Result.error("malformed-claims");

  // The grant table is applied at MINT, so a token whose caps exceed its kind's
  // grant can only come from drift (an edit to one of the two tables that missed
  // the other, or a mint site that learned to pass caps explicitly). Refuse it
  // rather than honour it. A SUBSET is fine: narrowing a grant later must not
  // invalidate tokens that are already in flight.
  const grantedCaps = GROWTH_RUN_TOKEN_CAPABILITIES_BY_KIND.get(session.sessionKind)
    ?? throwErr(`No growth run token capabilities are registered for session kind "${session.sessionKind}"`, { sessionKind: session.sessionKind });
  if (!caps.every((cap) => grantedCaps.includes(cap))) return Result.error("malformed-claims");

  return Result.ok({ ...session, tenancyId, branchId, caps });
}

/**
 * Whether the anchor row this session was dispatched for is still one this
 * session may act on. This is the growth analogue of the workflow token's
 * `leaseToken` check, and it is what gives cancellation, reaping and brief
 * completion immediate effect on an in-flight session.
 */
async function checkLiveAnchorState(claims: GrowthRunTokenClaims, options: {
  projectId: string,
  branchId: string,
}): Promise<GrowthRunTokenRejection | null> {
  switch (claims.sessionKind) {
    case "analysis_phase": {
      // Deliberately NOT $replica(): the CAS that minted this token is a write
      // this read must observe. Replica lag would reject a phase that was
      // legitimately claimed moments ago.
      const phase = await globalPrismaClient.growthAnalysisPhase.findUnique({
        where: { runId_phaseKey: { runId: claims.runId, phaseKey: claims.phaseKey } },
        select: { id: true, status: true, attempt: true, run: { select: { projectId: true, branchId: true, status: true } } },
      });
      if (phase == null) return "anchor-not-found";
      // The phase row is found by (run, phaseKey), so `sub` is not used for the
      // lookup — but a signed claim that is never checked is a claim that can
      // drift, so it is asserted rather than carried decoratively.
      if (phase.id !== claims.phaseId) return "anchor-not-found";
      // GrowthAnalysisPhase has no project/branch columns of its own; the run is
      // where tenancy scoping lives, and treating a foreign run as "not found"
      // keeps this path from confirming that a run id exists in another project.
      if (phase.run.projectId !== options.projectId || phase.run.branchId !== options.branchId) return "anchor-not-found";
      if (!GROWTH_ACTIVE_RUN_STATUSES.includes(phase.run.status)) return "anchor-not-active";
      // DISPATCHED (agent has not picked it up yet) and RUNNING (agent is
      // executing) are the only states in which a session speaks for the phase.
      // COMPLETED/FAILED/SKIPPED/PENDING all mean this session was superseded.
      if (phase.status !== GrowthPhaseStatus.DISPATCHED && phase.status !== GrowthPhaseStatus.RUNNING) return "anchor-not-active";
      // The fencing check: a reap resets the phase to PENDING and the next
      // dispatch increments `attempt`, so a zombie session from the previous
      // attempt loses its credential the instant the new attempt is claimed.
      if (phase.attempt !== claims.attempt) return "attempt-superseded";
      return null;
    }
    case "daily_brief": {
      const brief = await globalPrismaClient.growthBrief.findUnique({
        where: { id: claims.briefId },
        select: { projectId: true, branchId: true, status: true },
      });
      if (brief == null) return "anchor-not-found";
      if (brief.projectId !== options.projectId || brief.branchId !== options.branchId) return "anchor-not-found";
      // "generating" is the claim the daily rollup took on the day; once the
      // agent's content write flipped it to ready (or something skipped/failed
      // it), the session that was generating it is done.
      if (brief.status !== "generating") return "anchor-not-active";
      return null;
    }
    case "interview_turn": {
      const run = await globalPrismaClient.growthAnalysisRun.findUnique({
        where: { id: claims.runId },
        select: { projectId: true, branchId: true, interview: { select: { status: true } } },
      });
      if (run == null) return "anchor-not-found";
      if (run.projectId !== options.projectId || run.branchId !== options.branchId) return "anchor-not-found";
      // The run's own status is deliberately NOT checked: an interview turn can
      // legitimately be in flight while the run moves AWAITING_INTERVIEW →
      // RUNNING → AWAITING_INTERVIEW (see the adaptive-question write in
      // interview.ts). The interview row is the honest anchor.
      if (run.interview == null) return "anchor-not-found";
      if (run.interview.status === "completed" || run.interview.status === "skipped") return "anchor-not-active";
      return null;
    }
    case "chat_turn": {
      // Freeform chat has no durable anchor row — a turn is created and answered
      // inside one request — so the 3-minute TTL IS the whole live-state check.
      // That is acceptable because a chat token carries no capability the
      // conversation's own project scope does not already imply, and because the
      // window is shorter than the turn timeout it covers.
      return null;
    }
  }
}

/**
 * Full authentication: cryptographic verification, the (branch, tenancy)
 * binding, the requested capability, and finally the live anchor state.
 *
 * `tenancyId` is the tenancy the request already resolved from
 * (projectId, branchId). Comparing it to the token's own claim is what closes
 * the project-binding loop without an extra query.
 *
 * The capability check runs BEFORE the anchor read on purpose: it is free, and a
 * session asking for something its kind never grants should not get to make us
 * do a database lookup for it.
 */
export async function authenticateGrowthRunToken(options: {
  token: string,
  projectId: string,
  branchId: string,
  tenancyId: string,
  requireCapability: GrowthRunTokenCapability,
}): Promise<Result<GrowthRunTokenClaims, GrowthRunTokenRejection>> {
  const verified = await verifyGrowthRunTokenClaims(options.token, { projectId: options.projectId });
  if (verified.status === "error") return verified;
  const claims = verified.data;

  if (claims.branchId !== options.branchId) return Result.error("branch-mismatch");
  if (claims.tenancyId !== options.tenancyId) return Result.error("tenancy-mismatch");
  if (!claims.caps.includes(options.requireCapability)) return Result.error("capability-missing");

  const rejection = await checkLiveAnchorState(claims, { projectId: options.projectId, branchId: options.branchId });
  if (rejection != null) return Result.error(rejection);

  return Result.ok(claims);
}
