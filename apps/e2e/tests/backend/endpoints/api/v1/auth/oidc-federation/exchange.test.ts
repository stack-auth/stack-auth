import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "pg";
import { afterEach, beforeEach } from "vitest";
import { it } from "../../../../../../helpers";
import { niceBackendFetch, Project } from "../../../../../backend-helpers";
import { POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_USER } from "../../external-db-sync-utils";

/**
 * Mock OIDC IdP harness. Binds to a free port on localhost and serves:
 *  - `/.well-known/openid-configuration` → `{ issuer, jwks_uri }`
 *  - `/jwks` → the public JWK set
 *
 * The private key stays in-process so the test can mint tokens with arbitrary claims.
 */
type MockIdp = {
  issuerUrl: string,
  signToken: (payload: Record<string, unknown>, options?: { audience?: string | string[], expiresIn?: string, notBefore?: number }) => Promise<string>,
  close: () => Promise<void>,
};

async function startMockIdp(options?: { kid?: string, advertisedIssuer?: string }): Promise<MockIdp> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const kid = options?.kid ?? "test-key";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  // Set after the server starts listening, but read inside request handlers — by then the
  // closure has the bound port. No need to attach state to the Server instance itself.
  let issuerUrl: string;

  const server: Server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer: options?.advertisedIssuer ?? issuerUrl,
        jwks_uri: `${issuerUrl}/jwks`,
      }));
      return;
    }
    if (url.pathname === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  issuerUrl = `http://127.0.0.1:${address.port}`;

  const signToken = async (payload: Record<string, unknown>, opts?: { audience?: string | string[], expiresIn?: string, notBefore?: number }) => {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(options?.advertisedIssuer ?? issuerUrl)
      .setIssuedAt();
    if (opts?.audience !== undefined) jwt.setAudience(opts.audience);
    if (opts?.expiresIn !== undefined) jwt.setExpirationTime(opts.expiresIn);
    else jwt.setExpirationTime("5m");
    if (opts?.notBefore !== undefined) jwt.setNotBefore(opts.notBefore);
    return await jwt.sign(privateKey);
  };

  const close = async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  };

  return { issuerUrl, signToken, close };
}

/**
 * Register an enabled trust policy on the current project at branch scope. Returns the
 * generated policy id.
 */
async function registerTrustPolicy(options: {
  issuerUrl: string,
  audience: string,
  claimConditions?: {
    stringEquals?: Record<string, string>,
    stringLike?: Record<string, string>,
  },
  tokenTtlSeconds?: number,
  enabled?: boolean,
}): Promise<string> {
  const policyId = `test-${Math.random().toString(36).slice(2, 10)}`;

  const toValueRecord = (r: Record<string, string> | undefined) => {
    if (!r) return {};
    return Object.fromEntries(Object.entries(r).map(([claim, value]) => [claim, { "v": value }]));
  };

  // Trust policies live at the branch level but the environment config schema inherits from the
  // branch one, so writing the override at environment scope is equivalent for this test.
  await Project.updateConfig({
    [`oidcFederation.trustPolicies.${policyId}`]: {
      displayName: `Test policy ${policyId}`,
      enabled: options.enabled ?? true,
      issuerUrl: options.issuerUrl,
      audiences: { "a": options.audience },
      claimConditions: {
        stringEquals: toValueRecord(options.claimConditions?.stringEquals),
        stringLike: toValueRecord(options.claimConditions?.stringLike),
      },
      tokenTtlSeconds: options.tokenTtlSeconds ?? 300,
    },
  });
  return policyId;
}

function extractAccessToken(response: { body: unknown }): string {
  const body = response.body;
  if (typeof body !== "object" || body === null || !("access_token" in body) || typeof body.access_token !== "string") {
    throw new Error(`Expected exchange response body to contain an access_token string, got: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function postExchange(options: { subject_token: string, projectId: string }) {
  return await niceBackendFetch("/api/v1/auth/oidc-federation/exchange", {
    method: "POST",
    headers: { "x-stack-project-id": options.projectId },
    body: {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: options.subject_token,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    },
  });
}

// --- Test setup ---------------------------------------------------------

let mockIdp: MockIdp;
let projectId: string;

beforeEach(async () => {
  mockIdp = await startMockIdp();
  // createAndSwitch already sets the admin access token on the context, which Project.updateConfig
  // needs. Don't clobber it.
  const created = await Project.createAndSwitch();
  projectId = created.projectId;
});

afterEach(async () => {
  await mockIdp.close();
});

// --- Cases --------------------------------------------------------------

it("exchanges a well-formed OIDC token for a Stack server access token", async ({ expect }) => {
  await registerTrustPolicy({
    issuerUrl: mockIdp.issuerUrl,
    audience: "stack-auth-test",
    claimConditions: { stringEquals: { environment: "production" } },
  });
  const token = await mockIdp.signToken(
    { sub: "workload-1", environment: "production" },
    { audience: "stack-auth-test" },
  );

  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(200);
  expect(response.body.issued_token_type).toBe("urn:ietf:params:oauth:token-type:access_token");
  expect(response.body.token_type).toBe("Bearer");
  expect(typeof response.body.access_token).toBe("string");
  expect(typeof response.body.expires_in).toBe("number");
  expect(response.body.expires_in).toBeGreaterThan(0);
});

it("rejects when no trust policies are enabled", async ({ expect }) => {
  const token = await mockIdp.signToken({ sub: "workload-1" }, { audience: "anything" });
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("rejects when the audience doesn't match the policy", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const token = await mockIdp.signToken({ sub: "workload-1" }, { audience: "other-audience" });
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("rejects when the issuer is unknown to the policy", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: "http://127.0.0.1:1", audience: "stack-auth-test" });
  const token = await mockIdp.signToken({ sub: "workload-1" }, { audience: "stack-auth-test" });
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("rejects when the discovery document advertises a different issuer than the configured issuer URL", async ({ expect }) => {
  await mockIdp.close();
  mockIdp = await startMockIdp({ advertisedIssuer: "https://issuer-from-discovery.example.com" });
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const token = await mockIdp.signToken({ sub: "workload-1" }, { audience: "stack-auth-test" });
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("rejects when a StringEquals claim condition fails", async ({ expect }) => {
  await registerTrustPolicy({
    issuerUrl: mockIdp.issuerUrl,
    audience: "stack-auth-test",
    claimConditions: { stringEquals: { environment: "production" } },
  });
  const token = await mockIdp.signToken(
    { sub: "w", environment: "preview" },
    { audience: "stack-auth-test" },
  );
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("accepts when a StringLike claim condition matches with a wildcard", async ({ expect }) => {
  await registerTrustPolicy({
    issuerUrl: mockIdp.issuerUrl,
    audience: "stack-auth-test",
    claimConditions: { stringLike: { sub: "owner:acme:project:*:environment:production" } },
  });
  const token = await mockIdp.signToken(
    { sub: "owner:acme:project:app:environment:production" },
    { audience: "stack-auth-test" },
  );
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(200);
});

it("rejects an expired token", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const token = await mockIdp.signToken(
    { sub: "w" },
    { audience: "stack-auth-test", expiresIn: "-10m" },
  );
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("rejects a token signed by a different key", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  // Mint with a second, unrelated IdP's private key but claim the first IdP's issuer.
  const rogue = await startMockIdp();
  try {
    const payload = { sub: "w" };
    const { publicKey: _pk, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: "rogue-key" })
      .setIssuer(mockIdp.issuerUrl)
      .setAudience("stack-auth-test")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const response = await postExchange({ subject_token: token, projectId });
    expect(response.status).toBe(400);
  } finally {
    await rogue.close();
  }
});

it("ignores disabled policies", async ({ expect }) => {
  await registerTrustPolicy({
    issuerUrl: mockIdp.issuerUrl,
    audience: "stack-auth-test",
    enabled: false,
  });
  const token = await mockIdp.signToken({ sub: "w" }, { audience: "stack-auth-test" });
  const response = await postExchange({ subject_token: token, projectId });
  expect(response.status).toBe(400);
});

it("the issued access token is usable on a server-scoped endpoint", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const token = await mockIdp.signToken({ sub: "w" }, { audience: "stack-auth-test" });
  const exchange = await postExchange({ subject_token: token, projectId });
  expect(exchange.status).toBe(200);
  const serverAccessToken = extractAccessToken(exchange);

  // Hit a server-scoped endpoint (list users) using the federated access token in place of
  // the secret server key.
  const users = await niceBackendFetch("/api/v1/users?limit=5", {
    method: "GET",
    headers: {
      "x-stack-access-type": "server",
      "x-stack-project-id": projectId,
      "x-stack-server-access-token": serverAccessToken,
    },
  });
  expect(users.status).toBe(200);
});

it("rejects using a federated access token on a different branch than the one it was minted for", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const previewBranchId = `preview-${randomUUID()}`;
  const client = new Client({
    connectionString: `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}/stackframe`,
  });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO "Tenancy" ("id", "projectId", "branchId", "organizationId", "hasNoOrganization", "createdAt", "updatedAt") VALUES ($1, $2, $3, NULL, $4, NOW(), NOW())',
      [randomUUID(), projectId, previewBranchId, "TRUE"],
    );

    const token = await mockIdp.signToken({ sub: "w" }, { audience: "stack-auth-test" });
    const exchange = await postExchange({ subject_token: token, projectId });
    expect(exchange.status).toBe(200);
    const serverAccessToken = extractAccessToken(exchange);

    const users = await niceBackendFetch("/api/v1/users?limit=5", {
      method: "GET",
      headers: {
        "x-stack-access-type": "server",
        "x-stack-project-id": projectId,
        "x-stack-branch-id": previewBranchId,
        "x-stack-server-access-token": serverAccessToken,
      },
    });
    expect(users.status).toBe(401);
  } finally {
    await client.query(
      'DELETE FROM "Tenancy" WHERE "projectId" = $1 AND "branchId" = $2 AND "hasNoOrganization" = $3',
      [projectId, previewBranchId, "TRUE"],
    );
    await client.end();
  }
});

it("the federated access token is rejected on admin-scoped paths (no privilege escalation)", async ({ expect }) => {
  await registerTrustPolicy({ issuerUrl: mockIdp.issuerUrl, audience: "stack-auth-test" });
  const token = await mockIdp.signToken({ sub: "w" }, { audience: "stack-auth-test" });
  const exchange = await postExchange({ subject_token: token, projectId });
  expect(exchange.status).toBe(200);
  const serverAccessToken = extractAccessToken(exchange);

  // Attempt to use the federated token with access-type=admin. smart-request should reject
  // the combination outright (header is server-scope only).
  const admin = await niceBackendFetch("/api/v1/users?limit=1", {
    method: "GET",
    headers: {
      "x-stack-access-type": "admin",
      "x-stack-project-id": projectId,
      "x-stack-server-access-token": serverAccessToken,
    },
  });
  expect(admin.status).toBe(401);
});
