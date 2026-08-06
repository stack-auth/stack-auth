import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import * as http from "node:http";
import { afterAll, beforeAll, describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

let jwksServer: http.Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicJwk: JWK;

beforeAll(async () => {
  const keyPair = await generateKeyPair("ES256");
  privateKey = keyPair.privateKey;
  publicJwk = {
    ...await exportJWK(keyPair.publicKey),
    alg: "ES256",
    kid: "external-auth-e2e",
    use: "sig",
  };

  jwksServer = http.createServer((request, response) => {
    if (request.url !== "/jwks" && request.url !== "/.well-known/jwks.json") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve, reject) => {
    jwksServer.once("error", reject);
    jwksServer.listen(0, "127.0.0.1", resolve);
  });
  const address = jwksServer.address();
  if (address == null || typeof address === "string") {
    throw new Error("Expected the external-auth JWKS test server to listen on a TCP port");
  }
  issuer = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    jwksServer.close(error => error == null ? resolve() : reject(error));
  });
});

async function configureProject(options: { enabled?: boolean } = {}) {
  await Project.createAndSwitch();
  await Project.updateConfig({
    "apps.installed.better-auth-integration.enabled": options.enabled ?? true,
    "better-auth-integration.issuer": issuer,
    "better-auth-integration.audience": "hexclave-external-auth-e2e",
    "better-auth-integration.jwksUrl": new URL("/jwks", issuer).toString(),
  });
  backendContext.set({ userAuth: null });
}

async function createProviderToken(options: {
  subject?: string,
  sessionId?: string,
  issuer?: string,
  audience?: string,
  expirationTime?: string,
  authorizedParty?: string,
} = {}) {
  return await new SignJWT({
    sid: options.sessionId ?? "provider-session-1",
    ...options.authorizedParty == null ? {} : { azp: options.authorizedParty },
  })
    .setProtectedHeader({ alg: "ES256", kid: publicJwk.kid ?? throwErr("Test JWK has no kid") })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? "hexclave-external-auth-e2e")
    .setSubject(options.subject ?? "external-user-1")
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? "10m")
    .sign(privateKey);
}

async function exchange(token: string, providerId = "better-auth-integration") {
  return await niceBackendFetch("/api/latest/auth/external/token", {
    method: "POST",
    accessType: "client",
    body: {
      provider_id: providerId,
      token,
    },
  });
}

describe("external authentication token exchange", () => {
  it("creates one user and reuses provider sessions idempotently", async ({ expect }) => {
    await configureProject();
    const firstToken = await createProviderToken();
    const first = await exchange(firstToken);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      is_new_user: true,
    });
    expect(first.body.user_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.body.session_id).toMatch(/^[0-9a-f-]{36}$/);

    const repeated = await exchange(firstToken);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({
      is_new_user: false,
      user_id: first.body.user_id,
      session_id: first.body.session_id,
    });

    const secondSession = await exchange(await createProviderToken({ sessionId: "provider-session-2" }));
    expect(secondSession.status).toBe(200);
    expect(secondSession.body.user_id).toBe(first.body.user_id);
    expect(secondSession.body.session_id).not.toBe(first.body.session_id);

    backendContext.set({ userAuth: { accessToken: secondSession.body.access_token } });
    const sessions = await niceBackendFetch("/api/v1/auth/sessions", {
      method: "GET",
      accessType: "client",
      query: {
        user_id: first.body.user_id,
      },
    });
    expect(sessions.status).toBe(200);
    expect(sessions.body.items).toHaveLength(2);
    expect(sessions.body.items.filter((session: { is_current_session: boolean }) => session.is_current_session)).toHaveLength(1);
  });

  it("projects a new external identity once under concurrent exchanges", async ({ expect }) => {
    await configureProject();
    const token = await createProviderToken();
    const responses = await Promise.all(Array.from({ length: 4 }, async () => await exchange(token)));

    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    expect([...new Set(responses.map(response => response.body.user_id))]).toHaveLength(1);
    expect([...new Set(responses.map(response => response.body.session_id))]).toHaveLength(1);
    expect(responses.filter(response => response.body.is_new_user)).toHaveLength(1);

    // Losing racers create a user before discovering the identity was already projected; that user
    // must be cleaned up again, so exactly one user may remain in the project.
    const users = await niceBackendFetch("/api/v1/users", {
      accessType: "server",
    });
    expect(users.status).toBe(200);
    expect(users.body.items).toHaveLength(1);
    expect(users.body.items[0].id).toBe(responses[0].body.user_id);
  });

  it("rejects malformed and claim-invalid provider tokens", async ({ expect }) => {
    await configureProject();

    for (const token of [
      "not-a-jwt",
      await createProviderToken({ issuer: "https://wrong-issuer.example.com" }),
      await createProviderToken({ audience: "wrong-audience" }),
      await createProviderToken({ expirationTime: "0s" }),
    ]) {
      const response = await exchange(token);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe("INVALID_EXTERNAL_AUTH_TOKEN");
    }
  });

  it("enforces Clerk authorized parties even when azp is absent", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "apps.installed.clerk-integration.enabled": true,
      "clerk-integration.issuer": issuer,
      "clerk-integration.authorizedParties": "https://app.example.com",
    });
    backendContext.set({ userAuth: null });

    const missingAuthorizedParty = await exchange(await createProviderToken(), "clerk-integration");
    expect(missingAuthorizedParty.status).toBe(401);
    expect(missingAuthorizedParty.body.code).toBe("INVALID_EXTERNAL_AUTH_TOKEN");

    const allowed = await exchange(await createProviderToken({
      authorizedParty: "https://app.example.com",
    }), "clerk-integration");
    expect(allowed.status).toBe(200);
  });

  it("normalizes configured Clerk authorized parties to their origin", async ({ expect }) => {
    await Project.createAndSwitch();
    await Project.updateConfig({
      "apps.installed.clerk-integration.enabled": true,
      "clerk-integration.issuer": issuer,
      // A trailing slash (or path) in the dashboard config is cosmetic; the azp claim always
      // contains a bare origin, so the comparison must be origin-to-origin.
      "clerk-integration.authorizedParties": "https://app.example.com/some/path",
    });
    backendContext.set({ userAuth: null });

    const allowed = await exchange(await createProviderToken({
      authorizedParty: "https://app.example.com",
    }), "clerk-integration");
    expect(allowed.status).toBe(200);

    const rejected = await exchange(await createProviderToken({
      authorizedParty: "https://evil.example.com",
    }), "clerk-integration");
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe("INVALID_EXTERNAL_AUTH_TOKEN");
  });

  it("requires the integration app to be enabled", async ({ expect }) => {
    await configureProject({ enabled: false });
    const response = await exchange(await createProviderToken());
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("EXTERNAL_AUTH_PROVIDER_NOT_CONFIGURED");
  });
});
