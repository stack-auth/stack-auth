import { signJWT } from "@hexclave/shared/dist/utils/jwt";
import * as jose from "jose";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { phaseFindUniqueMock, briefFindUniqueMock, runFindUniqueMock } = vi.hoisted(() => ({
  phaseFindUniqueMock: vi.fn(),
  briefFindUniqueMock: vi.fn(),
  runFindUniqueMock: vi.fn(),
}));

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: {
    growthAnalysisPhase: { findUnique: phaseFindUniqueMock },
    growthBrief: { findUnique: briefFindUniqueMock },
    growthAnalysisRun: { findUnique: runFindUniqueMock },
  },
}));

import {
  authenticateGrowthRunToken,
  createGrowthRunToken,
  GROWTH_RUN_TOKEN_PREFIX,
  GROWTH_RUN_TOKEN_SESSION_KINDS,
  type GrowthRunTokenSession,
  isGrowthRunToken,
  shouldLogGrowthRunTokenRejection,
  verifyGrowthRunTokenClaims,
} from "./run-token";

const PROJECT_ID = "e1f2a3b4-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "e1f2a3b4-0000-4000-8000-000000000002";
const AUDIENCE = `growth-agent-run:${PROJECT_ID}`;
const OTHER_AUDIENCE = `growth-agent-run:${OTHER_PROJECT_ID}`;
const ISSUER = "hexclave-growth-orchestrator";

const TENANCY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BRANCH_ID = "main";
const RUN_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const PHASE_ID = "cccccccc-0000-4000-8000-000000000001";
const PHASE_KEY = "analysis:acquisition";
const ATTEMPT = 2;
const BRIEF_ID = "dddddddd-0000-4000-8000-000000000001";
const TURN_ID = "eeeeeeee-0000-4000-8000-000000000001";

const PHASE_SESSION: GrowthRunTokenSession = { sessionKind: "analysis_phase", phaseId: PHASE_ID, runId: RUN_ID, phaseKey: PHASE_KEY, attempt: ATTEMPT };
const BRIEF_SESSION: GrowthRunTokenSession = { sessionKind: "daily_brief", briefId: BRIEF_ID };
const INTERVIEW_SESSION: GrowthRunTokenSession = { sessionKind: "interview_turn", runId: RUN_ID };
const CHAT_SESSION: GrowthRunTokenSession = { sessionKind: "chat_turn", turnId: TURN_ID };

/** The payload the mint path produces for an analysis phase, for use in negative cases. */
const PHASE_PAYLOAD = {
  token_type: "growth_agent_run",
  sub: PHASE_ID,
  tenancy_id: TENANCY_ID,
  branch_id: BRANCH_ID,
  session_kind: "analysis_phase",
  caps: ["growth_agent_api"],
  run_id: RUN_ID,
  phase_key: PHASE_KEY,
  attempt: ATTEMPT,
};

async function mint(session: GrowthRunTokenSession = PHASE_SESSION, overrides?: { projectId?: string, branchId?: string, tenancyId?: string }) {
  return await createGrowthRunToken({
    projectId: overrides?.projectId ?? PROJECT_ID,
    branchId: overrides?.branchId ?? BRANCH_ID,
    tenancyId: overrides?.tenancyId ?? TENANCY_ID,
    session,
  });
}

/** Signs an arbitrary payload the way the orchestrator would, for negative cases. */
async function mintRaw(options: { audience?: string, issuer?: string, expirationTime?: string, payload?: Record<string, unknown> }) {
  return GROWTH_RUN_TOKEN_PREFIX + await signJWT({
    issuer: options.issuer ?? ISSUER,
    audience: options.audience ?? AUDIENCE,
    expirationTime: options.expirationTime ?? "10m",
    payload: options.payload ?? PHASE_PAYLOAD,
  });
}

function decode(token: string): jose.JWTPayload {
  return jose.decodeJwt(token.slice(GROWTH_RUN_TOKEN_PREFIX.length));
}

/**
 * Re-encodes a payload onto an existing token's header and signature. Every use of this is an
 * escalation attempt: the attacker controls the claims but not the key.
 */
function splicePayload(token: string, payload: Record<string, unknown>): string {
  const [header, , signature] = token.slice(GROWTH_RUN_TOKEN_PREFIX.length).split(".");
  const forged = Buffer.from(JSON.stringify({
    aud: AUDIENCE,
    iss: ISSUER,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...payload,
  })).toString("base64url");
  return `${GROWTH_RUN_TOKEN_PREFIX}${header}.${forged}.${signature}`;
}

describe("growth run token — cryptographic layer", () => {
  test("round-trips an analysis-phase session with the capabilities its kind grants", async () => {
    const token = await mint();
    expect(isGrowthRunToken(token)).toBe(true);

    const result = await verifyGrowthRunTokenClaims(token, { projectId: PROJECT_ID });
    expect(result.status === "ok" && result.data).toEqual({
      ...PHASE_SESSION,
      tenancyId: TENANCY_ID,
      branchId: BRANCH_ID,
      caps: ["growth_agent_api"],
    });
  });

  test.each([
    [BRIEF_SESSION, ["growth_agent_api"]],
    [INTERVIEW_SESSION, ["growth_agent_api"]],
    [CHAT_SESSION, ["growth_agent_api"]],
  ] as const)("round-trips a $0.sessionKind session with its granted capabilities", async (session, caps) => {
    const result = await verifyGrowthRunTokenClaims(await mint(session), { projectId: PROJECT_ID });
    expect(result.status === "ok" && result.data).toEqual({ ...session, tenancyId: TENANCY_ID, branchId: BRANCH_ID, caps });
  });

  test("no session kind is granted a capability to activate an entity or change a budget", async () => {
    // There is deliberately no such capability at all; this pins that no kind acquires one by a
    // future edit to the grant table.
    for (const sessionKind of GROWTH_RUN_TOKEN_SESSION_KINDS) {
      const session = ({
        analysis_phase: PHASE_SESSION,
        daily_brief: BRIEF_SESSION,
        interview_turn: INTERVIEW_SESSION,
        chat_turn: CHAT_SESSION,
      } satisfies Record<typeof sessionKind, GrowthRunTokenSession>)[sessionKind];
      const result = await verifyGrowthRunTokenClaims(await mint(session), { projectId: PROJECT_ID });
      const caps: readonly string[] = result.status === "ok" ? result.data.caps : [];
      expect(caps.every((cap) => ["growth_agent_api"].includes(cap))).toBe(true);
    }
  });

  test("isGrowthRunToken rejects absent and foreign credentials", () => {
    expect(isGrowthRunToken(null)).toBe(false);
    expect(isGrowthRunToken(undefined)).toBe(false);
    expect(isGrowthRunToken("")).toBe(false);
    // The shared growth agent secret, i.e. the value this predicate exists to route away from.
    expect(isGrowthRunToken("mock_growth_agent_secret")).toBe(false);
    expect(isGrowthRunToken("wrt_abcdef")).toBe(false);
  });

  test("puts the constant first in the audience so it cannot be read as a project id", async () => {
    // `decodeAccessToken` parses an access-token audience positionally as aud.split(":")[0]. If a run
    // token were ever replayed in the access-token header, that parse must not yield a real project
    // id — otherwise the issuer claim would be the only thing separating this credential from an
    // end-user one.
    const aud = String(decode(await mint()).aud);
    expect(aud).toBe(AUDIENCE);
    expect(aud.split(":").at(0)).not.toBe(PROJECT_ID);
  });

  test.each([
    ["analysis_phase", PHASE_SESSION, 50 * 60],
    ["daily_brief", BRIEF_SESSION, 50 * 60],
    ["interview_turn", INTERVIEW_SESSION, 3 * 60],
    ["chat_turn", CHAT_SESSION, 3 * 60],
  ] as const)("mints %s with the TTL its kind fixes, never a caller-supplied one", async (_kind, session, expectedSeconds) => {
    const payload = decode(await mint(session));
    // Also the "reject a TTL below 1 s" guard's real coverage: every registered TTL must be a
    // duration that mints a token which is alive when it is issued.
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(expectedSeconds);
  });

  test("is rejected for a different project, and the untampered audience is what catches it", async () => {
    const token = await mint();
    const result = await verifyGrowthRunTokenClaims(token, { projectId: OTHER_PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("CROSS-PROJECT REPLAY DIES AT THE CRYPTO LAYER, not merely at the audience check", async () => {
    // The property worth pinning: `getPrivateJwks` derives the signing key from the audience string,
    // so project A's token is signed with a DIFFERENT key than project B's. An attacker who rewrites
    // `aud` to the victim project therefore sails past the audience pre-check (it now matches the
    // request's project) and is stopped by signature verification instead — the audience check is a
    // defence in depth, not the thing standing between projects.
    const forged = splicePayload(await mint(), { ...PHASE_PAYLOAD, aud: OTHER_AUDIENCE });
    const result = await verifyGrowthRunTokenClaims(forged, { projectId: OTHER_PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("the same claims minted for two projects produce different signatures", async () => {
    // The direct observation behind the test above: identical payloads, different keys.
    const [a, b] = await Promise.all([mint(), mint(PHASE_SESSION, { projectId: OTHER_PROJECT_ID })]);
    const signatureOf = (token: string) => token.slice(GROWTH_RUN_TOKEN_PREFIX.length).split(".").at(2);
    expect(signatureOf(a)).not.toBe(signatureOf(b));
    // ...and each is valid for its own project, so the difference is the key and not a claim.
    expect((await verifyGrowthRunTokenClaims(b, { projectId: OTHER_PROJECT_ID })).status).toBe("ok");
  });

  test("is rejected without the prefix", async () => {
    const token = await mint();
    const result = await verifyGrowthRunTokenClaims(token.slice(GROWTH_RUN_TOKEN_PREFIX.length), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("not-a-run-token");
  });

  test("is rejected when the body is not a JWT", async () => {
    const result = await verifyGrowthRunTokenClaims(`${GROWTH_RUN_TOKEN_PREFIX}not-a-jwt`, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("unparsable");
  });

  test("is rejected when the signature is tampered with", async () => {
    const [header, payload, signature] = (await mint()).slice(GROWTH_RUN_TOKEN_PREFIX.length).split(".");
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const result = await verifyGrowthRunTokenClaims(`${GROWTH_RUN_TOKEN_PREFIX}${header}.${payload}.${flipped}`, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("is rejected when the payload is swapped for a re-encoded one", async () => {
    // Escalation attempt: keep a valid signature but point the token at another project's phase.
    const forged = splicePayload(await mint(), { ...PHASE_PAYLOAD, sub: "cccccccc-0000-4000-8000-00000000dead" });
    const result = await verifyGrowthRunTokenClaims(forged, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("is rejected when the caps claim is widened after signing", async () => {
    // The most valuable payload-swap variant: a session self-promoting to a capability its kind
    // was never granted. `meta_ads_build` is not in the closed set at all in this build, which makes
    // it a doubly-invalid value — exactly the shape a forged widening would take.
    const forged = splicePayload(await mint(), { ...PHASE_PAYLOAD, caps: ["growth_agent_api", "meta_ads_build"] });
    const result = await verifyGrowthRunTokenClaims(forged, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("is rejected once expired", async () => {
    const result = await verifyGrowthRunTokenClaims(await mintRaw({ expirationTime: "-60s" }), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("a token minted for another audience is not accepted", async () => {
    // Stands in for a user access token (audience `<projectId>`) being replayed as a run token.
    const result = await verifyGrowthRunTokenClaims(await mintRaw({ audience: PROJECT_ID }), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("an audience supplied as an array is not accepted", async () => {
    // Legal JWT, but neither the strict comparison nor verifyJWT can handle it, so it must be
    // rejected rather than coerced (a coercing check would accept `[victimAud, attackerAud]`).
    const forged = splicePayload(await mintRaw({}), { ...PHASE_PAYLOAD, aud: [AUDIENCE] });
    const result = await verifyGrowthRunTokenClaims(forged, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("a token from a different issuer is not accepted", async () => {
    const result = await verifyGrowthRunTokenClaims(
      await mintRaw({ issuer: "https://api.example.com/api/v1/projects/whatever" }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("a correctly signed token of the wrong type is not accepted", async () => {
    // A workflow run token or any other backend-minted JWT that happened to share this audience must
    // not authenticate a growth session.
    const result = await verifyGrowthRunTokenClaims(
      await mintRaw({ payload: { ...PHASE_PAYLOAD, token_type: "workflow_run" } }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("wrong-token-type");
  });

  test.each(["sub", "tenancy_id", "branch_id", "caps", "session_kind", "run_id", "phase_key", "attempt"] as const)(
    "a token missing %s is not accepted",
    async (claim) => {
      const payload: Record<string, unknown> = { ...PHASE_PAYLOAD };
      delete payload[claim];
      const result = await verifyGrowthRunTokenClaims(await mintRaw({ payload }), { projectId: PROJECT_ID });
      expect(result.status === "error" && result.error).toBe("malformed-claims");
    },
  );

  test.each([
    ["an unknown session kind", { session_kind: "sql_console" }],
    ["an empty capability list", { caps: [] }],
    ["a capability outside the closed set", { caps: ["growth_agent_api", "ads_activate"] }],
    ["capabilities that exceed the kind's grant", { caps: ["growth_agent_api", "meta_ads_read"] }],
    ["a caps claim that is not an array", { caps: "growth_agent_api" }],
    ["a non-integer attempt", { attempt: 1.5 }],
    ["a negative attempt", { attempt: -1 }],
    ["an attempt sent as a string", { attempt: "2" }],
  ] as const)("a correctly signed token with %s is not accepted", async (_label, override) => {
    const result = await verifyGrowthRunTokenClaims(
      await mintRaw({ payload: { ...PHASE_PAYLOAD, ...override } }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("malformed-claims");
  });

  test("a narrower capability list than the kind grants is still accepted", async () => {
    // Narrowing a grant must not invalidate tokens already in flight, so a SUBSET is fine — only
    // exceeding the grant is drift worth refusing.
    const result = await verifyGrowthRunTokenClaims(
      await mintRaw({ payload: { ...PHASE_PAYLOAD, caps: ["growth_agent_api"] } }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "ok" && result.data.caps).toEqual(["growth_agent_api"]);
  });

  test.each([
    ["daily_brief", { session_kind: "daily_brief", sub: BRIEF_ID, brief_id: "dddddddd-0000-4000-8000-00000000dead", caps: ["growth_agent_api"] }],
    ["interview_turn", { session_kind: "interview_turn", sub: RUN_ID, run_id: "bbbbbbbb-0000-4000-8000-00000000dead", caps: ["growth_agent_api"] }],
    ["chat_turn", { session_kind: "chat_turn", sub: TURN_ID, turn_id: "eeeeeeee-0000-4000-8000-00000000dead", caps: ["growth_agent_api"] }],
  ] as const)("a %s token whose named id disagrees with `sub` is not accepted", async (_kind, payload) => {
    // The named claim is emitted even when it duplicates `sub`; a duplicated claim that is never
    // cross-checked is a claim that can drift into meaning something different from the anchor the
    // live-state check reads.
    const result = await verifyGrowthRunTokenClaims(
      await mintRaw({ payload: { token_type: "growth_agent_run", tenancy_id: TENANCY_ID, branch_id: BRANCH_ID, ...payload } }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("malformed-claims");
  });
});

describe("growth run token — rejection logging classification", () => {
  test.each(["not-a-run-token", "unparsable", "audience-mismatch", "signature-or-expiry-invalid", "tenancy-not-found"] as const)(
    "does not log %s, which any unauthenticated caller can produce",
    (rejection) => {
      expect(shouldLogGrowthRunTokenRejection(rejection)).toBe(false);
    },
  );

  test.each(["issuer-mismatch", "wrong-token-type", "malformed-claims", "branch-mismatch", "tenancy-mismatch", "anchor-not-found", "anchor-not-active", "attempt-superseded", "capability-missing"] as const)(
    "logs %s, which requires a genuine backend-minted signature",
    (rejection) => {
      expect(shouldLogGrowthRunTokenRejection(rejection)).toBe(true);
    },
  );
});

describe("growth run token — live anchor state", () => {
  const activePhase = {
    id: PHASE_ID,
    status: "DISPATCHED",
    attempt: ATTEMPT,
    run: { projectId: PROJECT_ID, branchId: BRANCH_ID, status: "RUNNING" },
  };

  beforeEach(() => {
    phaseFindUniqueMock.mockReset();
    briefFindUniqueMock.mockReset();
    runFindUniqueMock.mockReset();
    phaseFindUniqueMock.mockResolvedValue(activePhase);
    briefFindUniqueMock.mockResolvedValue({ projectId: PROJECT_ID, branchId: BRANCH_ID, status: "generating" });
    runFindUniqueMock.mockResolvedValue({ projectId: PROJECT_ID, branchId: BRANCH_ID, interview: { status: "active" } });
  });

  const authenticate = async (overrides?: {
    token?: string,
    session?: GrowthRunTokenSession,
    projectId?: string,
    branchId?: string,
    tenancyId?: string,
    requireCapability?: "growth_agent_api",
  }) => {
    return await authenticateGrowthRunToken({
      token: overrides?.token ?? await mint(overrides?.session ?? PHASE_SESSION),
      projectId: overrides?.projectId ?? PROJECT_ID,
      branchId: overrides?.branchId ?? BRANCH_ID,
      tenancyId: overrides?.tenancyId ?? TENANCY_ID,
      requireCapability: overrides?.requireCapability ?? "growth_agent_api",
    });
  };

  const noDatabaseReads = () => {
    expect(phaseFindUniqueMock).not.toHaveBeenCalled();
    expect(briefFindUniqueMock).not.toHaveBeenCalled();
    expect(runFindUniqueMock).not.toHaveBeenCalled();
  };

  test("accepts a dispatched phase of a running run at the claimed attempt", async () => {
    const result = await authenticate();
    expect(result.status).toBe("ok");
  });

  test("never reaches the database for a cryptographically invalid token", async () => {
    const result = await authenticate({ token: await mintRaw({ expirationTime: "-60s" }) });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
    noDatabaseReads();
  });

  test("rejects a branch the token was not minted for", async () => {
    const result = await authenticate({ branchId: "some-other-branch" });
    expect(result.status === "error" && result.error).toBe("branch-mismatch");
    noDatabaseReads();
  });

  test("rejects when the request resolved to a different tenancy", async () => {
    const result = await authenticate({ tenancyId: "aaaaaaaa-0000-4000-8000-00000000dead" });
    expect(result.status === "error" && result.error).toBe("tenancy-mismatch");
    noDatabaseReads();
  });

  test("rejects a phase that no longer exists", async () => {
    phaseFindUniqueMock.mockResolvedValue(null);
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("anchor-not-found");
  });

  test("rejects when the phase row found by (run, phaseKey) is not the one `sub` names", async () => {
    phaseFindUniqueMock.mockResolvedValue({ ...activePhase, id: "cccccccc-0000-4000-8000-00000000dead" });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("anchor-not-found");
  });

  test.each([
    ["project", { projectId: OTHER_PROJECT_ID, branchId: BRANCH_ID, status: "RUNNING" }],
    ["branch", { projectId: PROJECT_ID, branchId: "some-other-branch", status: "RUNNING" }],
  ] as const)("treats a run in another %s as not found, never confirming it exists", async (_label, run) => {
    phaseFindUniqueMock.mockResolvedValue({ ...activePhase, run });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("anchor-not-found");
  });

  test.each(["COMPLETED", "FAILED", "CANCELLED"] as const)(
    "rejects a phase whose run has left the active set (%s) — this is what makes cancel take effect",
    async (status) => {
      phaseFindUniqueMock.mockResolvedValue({ ...activePhase, run: { ...activePhase.run, status } });
      const result = await authenticate();
      expect(result.status === "error" && result.error).toBe("anchor-not-active");
    },
  );

  test.each(["PENDING", "COMPLETED", "FAILED", "SKIPPED"] as const)(
    "rejects a phase in %s — only DISPATCHED and RUNNING mean a session speaks for it",
    async (status) => {
      phaseFindUniqueMock.mockResolvedValue({ ...activePhase, status });
      const result = await authenticate();
      expect(result.status === "error" && result.error).toBe("anchor-not-active");
    },
  );

  test("accepts a phase the agent has already started (RUNNING)", async () => {
    phaseFindUniqueMock.mockResolvedValue({ ...activePhase, status: "RUNNING" });
    expect((await authenticate()).status).toBe("ok");
  });

  test("rejects a zombie session whose phase was reaped and re-dispatched (attempt superseded)", async () => {
    // THE fencing check: reapStuckPhasesForRun resets a silent phase to PENDING and the next
    // claimAndDispatchPhase CAS increments `attempt`, so the old session's token stops authenticating
    // the moment the new attempt lands — even though its signature is still perfectly valid and its
    // phase is DISPATCHED again.
    phaseFindUniqueMock.mockResolvedValue({ ...activePhase, attempt: ATTEMPT + 1 });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("attempt-superseded");
  });

  test("rejects a token that claims an EARLIER attempt than the live phase", async () => {
    phaseFindUniqueMock.mockResolvedValue({ ...activePhase, attempt: ATTEMPT - 1 });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("attempt-superseded");
  });

  test("accepts a brief that is still generating", async () => {
    expect((await authenticate({ session: BRIEF_SESSION })).status).toBe("ok");
  });

  test.each(["ready", "skipped", "failed"] as const)("rejects a brief that has left generating (%s)", async (status) => {
    briefFindUniqueMock.mockResolvedValue({ projectId: PROJECT_ID, branchId: BRANCH_ID, status });
    const result = await authenticate({ session: BRIEF_SESSION });
    expect(result.status === "error" && result.error).toBe("anchor-not-active");
  });

  test.each([
    ["a missing brief", null],
    ["a brief in another project", { projectId: OTHER_PROJECT_ID, branchId: BRANCH_ID, status: "generating" }],
    ["a brief on another branch", { projectId: PROJECT_ID, branchId: "some-other-branch", status: "generating" }],
  ] as const)("rejects %s as not found", async (_label, brief) => {
    briefFindUniqueMock.mockResolvedValue(brief);
    const result = await authenticate({ session: BRIEF_SESSION });
    expect(result.status === "error" && result.error).toBe("anchor-not-found");
  });

  test.each(["pending", "active"] as const)("accepts an interview turn while the interview is %s", async (status) => {
    runFindUniqueMock.mockResolvedValue({ projectId: PROJECT_ID, branchId: BRANCH_ID, interview: { status } });
    expect((await authenticate({ session: INTERVIEW_SESSION })).status).toBe("ok");
  });

  test.each(["completed", "skipped"] as const)("rejects an interview turn once the interview is %s", async (status) => {
    runFindUniqueMock.mockResolvedValue({ projectId: PROJECT_ID, branchId: BRANCH_ID, interview: { status } });
    const result = await authenticate({ session: INTERVIEW_SESSION });
    expect(result.status === "error" && result.error).toBe("anchor-not-active");
  });

  test.each([
    ["a missing run", null],
    ["a run without an interview", { projectId: PROJECT_ID, branchId: BRANCH_ID, interview: null }],
    ["a run in another project", { projectId: OTHER_PROJECT_ID, branchId: BRANCH_ID, interview: { status: "active" } }],
  ] as const)("rejects an interview turn against %s as not found", async (_label, run) => {
    runFindUniqueMock.mockResolvedValue(run);
    const result = await authenticate({ session: INTERVIEW_SESSION });
    expect(result.status === "error" && result.error).toBe("anchor-not-found");
  });

  test("accepts a chat turn on its TTL alone, without reading any anchor", async () => {
    // Freeform chat has no durable anchor row, so the 3-minute TTL IS the live-state check. Asserting
    // the absence of a read pins that this is deliberate rather than a forgotten lookup.
    expect((await authenticate({ session: CHAT_SESSION })).status).toBe("ok");
    noDatabaseReads();
  });
});
