import { signJWT } from "@hexclave/shared/dist/utils/jwt";
import * as jose from "jose";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("@/prisma-client", () => ({
  globalPrismaClient: { workflowRun: { findUnique: findUniqueMock } },
}));

import { KnownErrors } from "@hexclave/shared";
import {
  authenticateWorkflowRunToken,
  authenticateWorkflowRunTokenRequestOrThrow,
  createWorkflowRunToken,
  getWorkflowRunTokenForRequest,
  isWorkflowRunToken,
  verifyWorkflowRunTokenClaims,
  WORKFLOW_RUN_TOKEN_PREFIX,
} from "./run-token";

const PROJECT_ID = "e1f2a3b4-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "e1f2a3b4-0000-4000-8000-000000000002";
const AUDIENCE = `workflow-run:${PROJECT_ID}`;
const ISSUER = "hexclave-workflow-engine";
const CLAIMS = {
  tenancyId: "aaaaaaaa-0000-4000-8000-000000000001",
  branchId: "main",
  runId: "bbbbbbbb-0000-4000-8000-000000000001",
  workflowId: "welcome-sequence",
  leaseToken: "cccccccc-0000-4000-8000-000000000001",
};
const PAYLOAD = {
  token_type: "workflow_run",
  sub: CLAIMS.runId,
  tenancy_id: CLAIMS.tenancyId,
  branch_id: CLAIMS.branchId,
  workflow_id: CLAIMS.workflowId,
  lease_token: CLAIMS.leaseToken,
};

async function mint(overrides?: Partial<Parameters<typeof createWorkflowRunToken>[0]>) {
  return await createWorkflowRunToken({
    projectId: PROJECT_ID,
    expiresInMs: 35 * 60 * 1000,
    ...CLAIMS,
    ...overrides,
  });
}

/** Signs an arbitrary payload the way the engine would, for negative cases. */
async function mintRaw(options: { audience?: string, issuer?: string, expirationTime?: string, payload?: Record<string, unknown> }) {
  return WORKFLOW_RUN_TOKEN_PREFIX + await signJWT({
    issuer: options.issuer ?? ISSUER,
    audience: options.audience ?? AUDIENCE,
    expirationTime: options.expirationTime ?? "10m",
    payload: options.payload ?? PAYLOAD,
  });
}

describe("workflow run token — cryptographic layer", () => {
  test("round-trips its claims", async () => {
    const token = await mint();
    expect(isWorkflowRunToken(token)).toBe(true);

    const result = await verifyWorkflowRunTokenClaims(token, { projectId: PROJECT_ID });
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.data).toEqual(CLAIMS);
  });

  test("isWorkflowRunToken rejects absent credentials", () => {
    // The nullable signature exists for the header call site in smart-request.
    expect(isWorkflowRunToken(null)).toBe(false);
    expect(isWorkflowRunToken(undefined)).toBe(false);
    expect(isWorkflowRunToken("")).toBe(false);
    expect(isWorkflowRunToken("sak_abcdef")).toBe(false);
  });

  test("puts the constant first in the audience so it cannot be read as a project id", async () => {
    // `decodeAccessToken` parses an access-token audience positionally as
    // aud.split(":")[0]. If a run token were ever replayed in the access-token
    // header, that parse must not yield a real project id — otherwise the
    // issuer claim would be the only thing separating a project-server
    // credential from an end-user one.
    const token = await mint();
    const aud = String(jose.decodeJwt(token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length)).aud);
    expect(aud).toBe(AUDIENCE);
    expect(aud.split(":")[0]).not.toBe(PROJECT_ID);
  });

  test("encodes the requested lifetime", async () => {
    const token = await mint({ expiresInMs: 35 * 60 * 1000 });
    const payload = jose.decodeJwt(token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length));
    const lifetimeSeconds = (payload.exp ?? 0) - (payload.iat ?? 0);
    expect(lifetimeSeconds).toBe(35 * 60);
  });

  test("refuses to mint a token that is already dead", async () => {
    await expect(mint({ expiresInMs: 0 })).rejects.toThrow();
    await expect(mint({ expiresInMs: -60_000 })).rejects.toThrow();
    await expect(mint({ expiresInMs: Number.NaN })).rejects.toThrow();
  });

  test("is rejected for a different project", async () => {
    // The audience is part of key derivation, so this is not merely a claim
    // check — the token is signed with a key the other project cannot produce.
    const token = await mint();
    const result = await verifyWorkflowRunTokenClaims(token, { projectId: OTHER_PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("is rejected without the prefix", async () => {
    const token = await mint();
    const result = await verifyWorkflowRunTokenClaims(token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("not-a-run-token");
  });

  test("is rejected when the body is not a JWT", async () => {
    const result = await verifyWorkflowRunTokenClaims(`${WORKFLOW_RUN_TOKEN_PREFIX}not-a-jwt`, { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("unparsable");
  });

  test("is rejected when the signature is tampered with", async () => {
    const token = await mint();
    const [header, payload, signature] = token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length).split(".");
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    const result = await verifyWorkflowRunTokenClaims(
      `${WORKFLOW_RUN_TOKEN_PREFIX}${header}.${payload}.${flipped}`,
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("is rejected when the payload is swapped for a re-encoded one", async () => {
    // Escalation attempt: keep a valid signature but point the token at a
    // different run.
    const token = await mint();
    const [header, , signature] = token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length).split(".");
    const forged = Buffer.from(JSON.stringify({
      ...PAYLOAD,
      sub: "dddddddd-0000-4000-8000-000000000009",
      aud: AUDIENCE,
      iss: ISSUER,
      exp: Math.floor(Date.now() / 1000) + 600,
    })).toString("base64url");
    const result = await verifyWorkflowRunTokenClaims(
      `${WORKFLOW_RUN_TOKEN_PREFIX}${header}.${forged}.${signature}`,
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("is rejected once expired", async () => {
    const result = await verifyWorkflowRunTokenClaims(await mintRaw({ expirationTime: "-60s" }), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("a token minted for another audience is not accepted", async () => {
    // Stands in for a user access token (audience `<projectId>`) being
    // replayed as a run token.
    const result = await verifyWorkflowRunTokenClaims(await mintRaw({ audience: PROJECT_ID }), { projectId: PROJECT_ID });
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("an audience supplied as an array is not accepted", async () => {
    // Legal JWT, but neither this check nor verifyJWT can handle it, so the
    // strict comparison must reject rather than coerce.
    const token = await mintRaw({});
    const [header, , signature] = token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length).split(".");
    const arrayAud = Buffer.from(JSON.stringify({
      ...PAYLOAD,
      aud: [AUDIENCE],
      iss: ISSUER,
      exp: Math.floor(Date.now() / 1000) + 600,
    })).toString("base64url");
    const result = await verifyWorkflowRunTokenClaims(
      `${WORKFLOW_RUN_TOKEN_PREFIX}${header}.${arrayAud}.${signature}`,
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("audience-mismatch");
  });

  test("a token from a different issuer is not accepted", async () => {
    const result = await verifyWorkflowRunTokenClaims(
      await mintRaw({ issuer: "https://api.example.com/api/v1/projects/whatever" }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
  });

  test("a correctly signed token of the wrong type is not accepted", async () => {
    const result = await verifyWorkflowRunTokenClaims(
      await mintRaw({ payload: { ...PAYLOAD, token_type: "something_else" } }),
      { projectId: PROJECT_ID },
    );
    expect(result.status === "error" && result.error).toBe("wrong-token-type");
  });

  test.each(["sub", "tenancy_id", "branch_id", "workflow_id", "lease_token"] as const)(
    "a token missing %s is not accepted",
    async (claim) => {
      const payload: Record<string, unknown> = { ...PAYLOAD };
      delete payload[claim];
      const result = await verifyWorkflowRunTokenClaims(await mintRaw({ payload }), { projectId: PROJECT_ID });
      expect(result.status === "error" && result.error).toBe("malformed-claims");
    },
  );
});

describe("workflow run token — live state check", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValue({ state: "RUNNING", leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
  });

  const authenticate = async (overrides?: { branchId?: string, tenancyId?: string, projectId?: string, token?: string }) => {
    return await authenticateWorkflowRunToken({
      token: overrides?.token ?? await mint(),
      projectId: overrides?.projectId ?? PROJECT_ID,
      branchId: overrides?.branchId ?? CLAIMS.branchId,
      tenancyId: overrides?.tenancyId ?? CLAIMS.tenancyId,
    });
  };

  test("accepts a running run whose lease still matches", async () => {
    const result = await authenticate();
    expect(result.status).toBe("ok");
  });

  test("never reaches the database for a cryptographically invalid token", async () => {
    const result = await authenticate({ token: await mintRaw({ expirationTime: "-60s" }) });
    expect(result.status === "error" && result.error).toBe("signature-or-expiry-invalid");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test("rejects a branch the token was not minted for", async () => {
    const result = await authenticate({ branchId: "some-other-branch" });
    expect(result.status === "error" && result.error).toBe("branch-mismatch");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test("rejects when the request resolved to a different tenancy", async () => {
    const result = await authenticate({ tenancyId: "aaaaaaaa-0000-4000-8000-00000000dead" });
    expect(result.status === "error" && result.error).toBe("tenancy-mismatch");
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test("rejects when the run no longer exists", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("run-not-found");
  });

  test.each(["CANCELED", "FAILED", "COMPLETED", "SLEEPING", "QUEUED"] as const)(
    "rejects a run that has left RUNNING (%s) — this is what makes cancel take effect",
    async (state) => {
      findUniqueMock.mockResolvedValue({ state, leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
      const result = await authenticate();
      expect(result.status === "error" && result.error).toBe("run-not-running");
    },
  );

  test("rejects a sandbox whose run was re-claimed by another worker", async () => {
    findUniqueMock.mockResolvedValue({ state: "RUNNING", leaseToken: "cccccccc-0000-4000-8000-00000000ffff", workflowId: CLAIMS.workflowId });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("lease-superseded");
  });

  test("rejects a run whose lease token was cleared", async () => {
    findUniqueMock.mockResolvedValue({ state: "RUNNING", leaseToken: null, workflowId: CLAIMS.workflowId });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("lease-superseded");
  });

  test("rejects when the run belongs to a different workflow than the token claims", async () => {
    findUniqueMock.mockResolvedValue({ state: "RUNNING", leaseToken: CLAIMS.leaseToken, workflowId: "some-other-workflow" });
    const result = await authenticate();
    expect(result.status === "error" && result.error).toBe("workflow-mismatch");
  });
});

describe("workflow run token — request routing (server scope)", () => {
  test("authenticates server-type requests", () => {
    expect(getWorkflowRunTokenForRequest({ requestType: "server", secretServerKey: "wrt_x" })).toBe("wrt_x");
  });

  test("authenticates client-type requests, which are strictly weaker", () => {
    expect(getWorkflowRunTokenForRequest({ requestType: "client", secretServerKey: "wrt_x" })).toBe("wrt_x");
  });

  test("NEVER authenticates admin-type requests — this is the token's scope boundary", () => {
    // The whole point of the credential being server-scoped. An admin-type
    // request must fall through to the ordinary admin-key path instead.
    expect(getWorkflowRunTokenForRequest({ requestType: "admin", secretServerKey: "wrt_x" })).toBeNull();
  });

  test("ignores real keys and absent credentials", () => {
    expect(getWorkflowRunTokenForRequest({ requestType: "server", secretServerKey: "ssk_abc123" })).toBeNull();
    expect(getWorkflowRunTokenForRequest({ requestType: "server", secretServerKey: null })).toBeNull();
    expect(getWorkflowRunTokenForRequest({ requestType: "client", secretServerKey: "pck_abc123" })).toBeNull();
  });

  test("only reads the server-key header — a token in the admin slot is not routed here", () => {
    // A `wrt_` value in the admin header must be left to the ApiKeySet lookup,
    // which cannot match it. Routing it here would hand admin scope back.
    expect(getWorkflowRunTokenForRequest({ requestType: "admin", secretServerKey: null })).toBeNull();
    expect(getWorkflowRunTokenForRequest({ requestType: "server", secretServerKey: null })).toBeNull();
  });
});

describe("workflow run token — auth-path entry point", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  beforeEach(() => {
    findUniqueMock.mockReset();
    findUniqueMock.mockResolvedValue({ state: "RUNNING", leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
    consoleLogSpy.mockClear();
  });

  const authenticateRequest = async (overrides?: { token?: string, tenancyId?: string | null }) => {
    return await authenticateWorkflowRunTokenRequestOrThrow({
      token: overrides?.token ?? await mint(),
      projectId: PROJECT_ID,
      branchId: CLAIMS.branchId,
      tenancyId: overrides && "tenancyId" in overrides ? overrides.tenancyId ?? null : CLAIMS.tenancyId,
    });
  };

  test("returns the claims for a valid token on a running run", async () => {
    const claims = await authenticateRequest();
    expect(claims.runId).toBe(CLAIMS.runId);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("maps a rejection to the invalid-server-key error — the token is a server credential, never an admin one", async () => {
    findUniqueMock.mockResolvedValue({ state: "CANCELED", leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
    await expect(authenticateRequest()).rejects.toThrow(KnownErrors.InvalidSecretServerKey);
  });

  test("treats an unresolved tenancy as an authentication failure, without a log line or a DB read", async () => {
    await expect(authenticateRequest({ tenancyId: null })).rejects.toThrow(KnownErrors.InvalidSecretServerKey);
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test("does not log rejections reachable by unauthenticated callers (forged signature)", async () => {
    await expect(authenticateRequest({ token: await mintRaw({ expirationTime: "-60s" }) })).rejects.toThrow(KnownErrors.InvalidSecretServerKey);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("logs when a GENUINE engine-minted token is rejected (canceled run still calling out)", async () => {
    findUniqueMock.mockResolvedValue({ state: "CANCELED", leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
    await expect(authenticateRequest()).rejects.toThrow(KnownErrors.InvalidSecretServerKey);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy.mock.calls[0][0]).toContain("run-not-running");
  });

  test("never leaks the rejection reason in the thrown error", async () => {
    findUniqueMock.mockResolvedValue({ state: "CANCELED", leaseToken: CLAIMS.leaseToken, workflowId: CLAIMS.workflowId });
    const thrown: unknown = await authenticateRequest().catch((e: unknown) => e);
    if (!(thrown instanceof Error)) throw new Error("expected authenticateRequest to throw an Error");
    expect(`${thrown.message} ${JSON.stringify(Object.entries(thrown))}`).not.toContain("run-not-running");
  });
});
