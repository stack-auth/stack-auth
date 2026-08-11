import { createHash } from "node:crypto";
import { createMcpTokenVerifier } from "@hexclave/js/mcp";
import { expect } from "vitest";
import { it, niceFetch, STACK_BACKEND_BASE_URL, updateCookiesFromResponse } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

const oauthCodeVerifier = "a".repeat(43);
const oauthCodeChallenge = createHash("sha256").update(oauthCodeVerifier).digest("base64url");

async function createConfiguredProject(options: { trustedClient?: boolean, includeWriteScope?: boolean } = {}) {
  const { projectId } = await Project.createAndSwitch();
  await Project.pushConfig({
    oauthProvider: {
      scopes: {
        filesRead: {
          scope: "files:read",
          displayName: "Read files",
        },
        ...(options.includeWriteScope ? {
          filesWrite: {
            scope: "files:write",
            displayName: "Write files",
          },
        } : {}),
      },
      resources: {
        mcp: {
          uri: "https://mcp.example.com/mcp",
          scopes: {
            filesRead: { scope: "files:read" },
          },
        },
      },
      clients: {
        testClient: {
          displayName: "Test client",
          redirectUris: {
            callback: { url: "http://localhost:30000/callback" },
          },
          type: "public",
          ...(options.trustedClient === true ? { trusted: true } : {}),
        },
      },
      dynamicClientRegistration: { enabled: true },
      clientIdMetadataDocuments: { enabled: false },
      consent: {
        required: true,
        allowUserToDeselectOptionalScopes: true,
      },
    },
  });
  return projectId;
}

function providerUrl(projectId: string, suffix: string): string {
  return new URL(`/api/v1/projects/${projectId}/oidc${suffix}`, STACK_BACKEND_BASE_URL).toString();
}

function pathInsertionUrl(projectId: string, metadata: "openid-configuration" | "oauth-authorization-server"): string {
  return new URL(`/.well-known/${metadata}/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
}

function normalizeIssuerUrl(url: string, issuer: string): string {
  return url.replace(issuer, "<issuer>");
}

function expectNoExpiredProviderSessionCookie(response: { headers: Headers }): void {
  for (const cookie of response.headers.getSetCookie()) {
    if (/^_session(?:\.legacy)?(?:\.sig)?=/i.test(cookie)) {
      expect(cookie).not.toMatch(/expires=Thu, 01 Jan 1970/i);
    }
  }
}

async function startProjectInteraction(
  projectId: string,
  scope = "openid files:read",
  initialCookie = "",
  prompt?: string,
) {
  const authorize = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    redirect: "manual",
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      scope,
      resource: "https://mcp.example.com/mcp",
      code_challenge: oauthCodeChallenge,
      code_challenge_method: "S256",
      ...(prompt === undefined ? {} : { prompt }),
    },
    headers: { cookie: initialCookie },
  });
  expect(authorize.status).toBe(303);
  const providerCookie = updateCookiesFromResponse(initialCookie, authorize);
  const interactionLocation = authorize.headers.get("location") ?? "";
  const interaction = await niceBackendFetch(interactionLocation, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(interaction.status).toBe(307);
  const sessionCookie = updateCookiesFromResponse(providerCookie, interaction);
  return {
    interactionUid: new URL(interactionLocation).pathname.split("/").at(-1) ?? "",
    providerCookie: sessionCookie,
  };
}

async function getProjectAuthorizationCode(projectId: string): Promise<string> {
  const { interactionUid, providerCookie } = await startProjectInteraction(projectId);
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(decision.status).toBe(200);
  const completed = await niceBackendFetch(decision.body.done_url, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expectNoExpiredProviderSessionCookie(completed);
  expect(completed.status).toBe(303);
  const resumed = await niceBackendFetch(completed.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(providerCookie, completed) },
  });
  expect(resumed.status).toBe(303);
  return new URL(resumed.headers.get("location") ?? "").searchParams.get("code") ?? "";
}

it("serves OAuth/OIDC discovery and project-provider JWKS", async () => {
  const projectId = await createConfiguredProject();
  const issuer = providerUrl(projectId, "");

  const openidConfiguration = await niceBackendFetch(providerUrl(projectId, "/.well-known/openid-configuration"));
  expect(openidConfiguration.status).toBe(200);
  expect({
    issuer: normalizeIssuerUrl(openidConfiguration.body.issuer, issuer),
    authorization_endpoint: normalizeIssuerUrl(openidConfiguration.body.authorization_endpoint, issuer),
    token_endpoint: normalizeIssuerUrl(openidConfiguration.body.token_endpoint, issuer),
    registration_endpoint: normalizeIssuerUrl(openidConfiguration.body.registration_endpoint, issuer),
    jwks_uri: normalizeIssuerUrl(openidConfiguration.body.jwks_uri, issuer),
    code_challenge_methods_supported: openidConfiguration.body.code_challenge_methods_supported,
    scopes_supported: openidConfiguration.body.scopes_supported,
  }).toMatchInlineSnapshot(`
    {
      "authorization_endpoint": "<issuer>/auth",
      "code_challenge_methods_supported": ["S256"],
      "issuer": "<issuer>",
      "jwks_uri": "<issuer>/.well-known/jwks.json",
      "registration_endpoint": "<issuer>/reg",
      "scopes_supported": [
        "address",
        "email",
        "files:read",
        "offline_access",
        "openid",
        "phone",
        "profile",
        "team_perm:$delete_team",
        "team_perm:$invite_members",
        "team_perm:$manage_api_keys",
        "team_perm:$read_members",
        "team_perm:$remove_members",
        "team_perm:$update_team",
        "team_perm:team_admin",
        "team_perm:team_member",
      ],
      "token_endpoint": "<issuer>/token",
    }
  `);
  expect(openidConfiguration.body.issuer).toBe(issuer);
  expect(openidConfiguration.body.authorization_endpoint).toBe(`${issuer}/auth`);
  for (const metadata of ["openid-configuration", "oauth-authorization-server"] as const) {
    const response = await niceBackendFetch(pathInsertionUrl(projectId, metadata));
    expect(response.status).toBe(200);
    expect(response.body.issuer).toBe(issuer);
  }
  const unknownProject = await niceBackendFetch(pathInsertionUrl("missing-project", "openid-configuration"));
  expect(unknownProject.status).toBe(404);
  const bareDiscovery = await niceBackendFetch(new URL("/.well-known/openid-configuration", STACK_BACKEND_BASE_URL));
  expect(bareDiscovery.status).toBe(404);
  expect(openidConfiguration.body.token_endpoint).toBe(`${issuer}/token`);
  expect(openidConfiguration.body.registration_endpoint).toBe(`${issuer}/reg`);
  expect(openidConfiguration.body.jwks_uri).toBe(`${issuer}/.well-known/jwks.json`);
  expect(openidConfiguration.headers.get("access-control-allow-origin")).toBe("*");

  const oauthConfiguration = await niceBackendFetch(providerUrl(projectId, "/.well-known/oauth-authorization-server"));
  expect(oauthConfiguration.status).toBe(200);
  expect(oauthConfiguration.body).toEqual(openidConfiguration.body);
  expect(oauthConfiguration.headers.get("access-control-allow-origin")).toBe("*");

  const issuerOpenidAlias = await niceBackendFetch(pathInsertionUrl(projectId, "openid-configuration"));
  const issuerOAuthAlias = await niceBackendFetch(pathInsertionUrl(projectId, "oauth-authorization-server"));
  expect(issuerOpenidAlias.status).toBe(200);
  expect(issuerOAuthAlias.status).toBe(200);
  expect(issuerOpenidAlias.body).toEqual(openidConfiguration.body);
  expect(issuerOAuthAlias.body).toEqual(openidConfiguration.body);
  expect(issuerOpenidAlias.headers.get("access-control-allow-origin")).toBe("*");

  const jwks = await niceBackendFetch(providerUrl(projectId, "/.well-known/jwks.json"));
  expect(jwks.status).toBe(200);
  expect(jwks.body).toMatchObject({ keys: expect.any(Array) });
  expect(issuer).toContain(`/api/v1/projects/${projectId}/oidc`);

  const registration = await niceBackendFetch(providerUrl(projectId, "/reg"), {
    method: "POST",
    body: {},
  });
  expect(registration.status).toBe(400);

  const revocation = await niceBackendFetch(providerUrl(projectId, "/token/revocation"), {
    method: "POST",
    body: {},
  });
  expect(revocation.status).toBe(400);
  expect(revocation.headers.get("access-control-allow-origin")).toBe("*");

  for (const path of [
    "/.well-known/openid-configuration",
    "/.well-known/oauth-authorization-server",
    "/token",
    "/reg",
    "/token/revocation",
  ]) {
    const preflight = await niceBackendFetch(providerUrl(projectId, path), {
      method: "OPTIONS",
      headers: {
        Origin: "https://mcp.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  }

  const aliasPreflight = await niceBackendFetch(pathInsertionUrl(projectId, "oauth-authorization-server"), {
    method: "OPTIONS",
    headers: {
      Origin: "https://mcp.example.com",
      "Access-Control-Request-Method": "GET",
    },
  });
  expect(aliasPreflight.status).toBe(200);
  expect(aliasPreflight.headers.get("access-control-allow-origin")).toBe("*");
});

it("returns a safe 404 for an unknown project", async () => {
  const response = await niceBackendFetch("/api/v1/projects/00000000-0000-4000-8000-000000000000/oidc/.well-known/openid-configuration");
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Project not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("renders a user-safe page for project-provider errors on authorization navigation", async () => {
  const response = await niceFetch(providerUrl("internal", "/auth/not-a-real-interaction"), {
    headers: { accept: "text/html" },
  });
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.body).toContain("Authorization unavailable");
  expect(response.body).not.toContain("\"error\"");
});

it("reconciles a replaced provider session after a completed authorization", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();

  const first = await startProjectInteraction(projectId);
  const firstDecision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${first.interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(firstDecision.status).toBe(200);
  const firstCompleted = await niceBackendFetch(firstDecision.body.done_url, {
    redirect: "manual",
    headers: { cookie: first.providerCookie },
  });
  const firstResumed = await niceBackendFetch(firstCompleted.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(first.providerCookie, firstCompleted) },
  });
  expect(firstResumed.status).toBe(303);
  const dirtyProviderCookie = updateCookiesFromResponse(first.providerCookie, firstResumed);
  const dirtySessionCookie = dirtyProviderCookie
    .split("; ")
    .filter(cookie => cookie.startsWith("_session"))
    .join("; ");

  const second = await startProjectInteraction(projectId, "openid files:read", dirtySessionCookie, "login");
  const rotation = await startProjectInteraction(projectId);
  const rotationDecision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${rotation.interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(rotationDecision.status).toBe(200);
  const rotationCompleted = await niceBackendFetch(rotationDecision.body.done_url, {
    redirect: "manual",
    headers: { cookie: rotation.providerCookie },
  });
  const rotationResumed = await niceBackendFetch(rotationCompleted.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(rotation.providerCookie, rotationCompleted) },
  });
  expect(rotationResumed.status).toBe(303);
  const rotatedProviderCookie = updateCookiesFromResponse(rotation.providerCookie, rotationResumed);
  const mismatchedProviderCookie = [
    ...second.providerCookie.split("; ").filter(cookie => !cookie.startsWith("_session")),
    ...rotatedProviderCookie.split("; ").filter(cookie => cookie.startsWith("_session")),
  ].join("; ");

  const secondDecision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${second.interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(secondDecision.status).toBe(200);
  const secondCompleted = await niceBackendFetch(secondDecision.body.done_url, {
    redirect: "manual",
    headers: { cookie: mismatchedProviderCookie },
  });
  expectNoExpiredProviderSessionCookie(secondCompleted);
  expect(secondCompleted.status).toBe(303);
  const secondResumed = await niceBackendFetch(secondCompleted.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(mismatchedProviderCookie, secondCompleted) },
  });
  expect(secondResumed.status).toBe(303);
  const callback = new URL(secondResumed.headers.get("location") ?? "");
  const code = callback.searchParams.get("code");
  expect(code).not.toBeNull();
  const token = await niceBackendFetch(providerUrl(projectId, "/token"), {
    method: "POST",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      code_verifier: oauthCodeVerifier,
      resource: "https://mcp.example.com/mcp",
    }).toString()),
    rawContentType: "application/x-www-form-urlencoded",
  });
  expect(token.status).toBe(200);
  const verifier = createMcpTokenVerifier({
    projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    resource: "https://mcp.example.com/mcp",
  });
  await expect(verifier.verifyAccessToken(token.body.access_token)).resolves.toMatchObject({
    scopes: ["files:read"],
    resource: new URL("https://mcp.example.com/mcp"),
  });
}, 60_000);

it("rejects unknown clients and authorization requests without PKCE", async () => {
  const projectId = await createConfiguredProject();
  const unknownClient = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    headers: { accept: "application/json" },
    query: {
      response_type: "code",
      client_id: "unknown-client",
      redirect_uri: "http://localhost:30000/callback",
      code_challenge: oauthCodeChallenge,
      code_challenge_method: "S256",
    },
  });
  expect(unknownClient.status).toBe(400);
  expect(unknownClient.body).toMatchObject({ error: "invalid_client" });

  const missingPkce = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    redirect: "manual",
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
    },
  });
  expect(missingPkce.status).toBe(303);
  expect(new URL(missingPkce.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_request");
});

it("reads and records an authenticated project OAuth interaction", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  const authorize = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    redirect: "manual",
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      scope: "openid files:read",
      code_challenge: oauthCodeChallenge,
      code_challenge_method: "S256",
    },
  });
  expect(authorize.status).toBe(303);
  const providerCookie = updateCookiesFromResponse("", authorize);
  const interactionLocation = authorize.headers.get("location") ?? "";
  const interaction = await niceBackendFetch(interactionLocation, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(interaction.status).toBe(307);
  const interactionUid = new URL(interactionLocation).pathname.split("/").at(-1) ?? "";
  const details = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    accessType: "client",
  });
  expect(details.status).toBe(200);
  expect(details.body).toMatchObject({
    client: { id: "testClient", display_name: "Test client" },
    scopes: [
      { scope: "openid" },
      { scope: "files:read", display_name: "Read files" },
    ],
    resource: { uri: "https://mcp.example.com/mcp" },
    trusted_client: false,
    allow_user_to_deselect_optional_scopes: false,
  });
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: {
      approved_scopes: ["openid", "files:read"],
      denied: false,
    },
  });
  expect(decision.status).toBe(200);
  expect(decision.body.done_url).toBe(providerUrl(projectId, `/interaction/${interactionUid}/done`));
});

it("completes the signed-out-first project OAuth authorization code flow", async () => {
  const projectId = await createConfiguredProject();
  const normalSession = await Auth.fastSignUp();
  const authorize = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    redirect: "manual",
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      scope: "openid profile email offline_access files:read",
      resource: "https://mcp.example.com/mcp",
      prompt: "consent",
      code_challenge: oauthCodeChallenge,
      code_challenge_method: "S256",
    },
  });
  expect(authorize.status).toBe(303);
  const providerCookie = updateCookiesFromResponse("", authorize);
  const interactionLocation = authorize.headers.get("location") ?? "";
  const interaction = await niceBackendFetch(interactionLocation, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(interaction.status).toBe(307);
  const providerSessionCookie = updateCookiesFromResponse(providerCookie, interaction);
  expect(providerSessionCookie).toContain("_session=");
  const interactionUid = new URL(interactionLocation).pathname.split("/").at(-1) ?? "";
  const fullDetails = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    accessType: "client",
  });
  expect(fullDetails.body.scopes).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: "openid" }),
    expect.objectContaining({ scope: "profile" }),
    expect.objectContaining({ scope: "email" }),
    expect.objectContaining({ scope: "offline_access" }),
    expect.objectContaining({ scope: "files:read" }),
  ]));
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "profile", "email", "offline_access", "files:read"], denied: false },
  });
  expect(decision.status).toBe(200);
  const completed = await niceBackendFetch(decision.body.done_url, {
    method: "POST",
    redirect: "manual",
    headers: { cookie: providerSessionCookie },
  });
  expect(completed.status).toBe(303);
  const resumed = await niceBackendFetch(completed.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(providerSessionCookie, completed) },
  });
  expect(resumed.status).toBe(303);
  const callback = new URL(resumed.headers.get("location") ?? "");
  expect(callback.origin).toBe("http://localhost:30000");
  const code = callback.searchParams.get("code");
  expect(code).not.toBeNull();
  const token = await niceBackendFetch(providerUrl(projectId, "/token"), {
    method: "POST",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      code_verifier: oauthCodeVerifier,
      resource: "https://mcp.example.com/mcp",
    }).toString()),
    rawContentType: "application/x-www-form-urlencoded",
  });
  expect(token.status).toBe(200);
  const accessTokenPayload = JSON.parse(Buffer.from(token.body.access_token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    iss?: string,
    aud?: string | string[],
    resource?: string,
    scope?: string,
  };
  expect(token.body).toMatchObject({
    token_type: "Bearer",
    scope: "files:read",
  });
  expect(accessTokenPayload).toMatchObject({
    iss: providerUrl(projectId, ""),
    aud: expect.any(String),
    resource: "https://mcp.example.com/mcp",
    scope: "files:read",
  });
  const verifier = createMcpTokenVerifier({
    projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    resource: "https://mcp.example.com/mcp",
  });
  await expect(verifier.verifyAccessToken(token.body.access_token)).resolves.toMatchObject({
    scopes: ["files:read"],
    resource: new URL("https://mcp.example.com/mcp"),
  });
  const normalSessionControl = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
  });
  expect(normalSessionControl.status).toBe(200);
  const rejectedByAccessTokenHeader = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    userAuth: {},
    headers: { "x-stack-access-token": token.body.access_token },
  });
  expect(rejectedByAccessTokenHeader.status).toBe(401);
  const rejectedByAuthorizationHeader = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    userAuth: {},
    headers: { Authorization: `Bearer ${token.body.access_token}` },
  });
  expect(rejectedByAuthorizationHeader.status).toBe(400);
  const authorizationHeaderNormalSessionControl = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    userAuth: {},
    headers: { Authorization: `Bearer ${normalSession.accessToken}` },
  });
  // The main API does not accept Authorization: Bearer for any session type; both tokens reach
  // the same header-validation 400. The x-stack-access-token assertion above is the token-specific
  // rejection check, while this control prevents the Bearer result from being misread as one.
  expect(authorizationHeaderNormalSessionControl.status).toBe(400);
  const refreshed = await niceBackendFetch(providerUrl(projectId, "/token"), {
    method: "POST",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.body.refresh_token,
      client_id: "testClient",
      resource: "https://mcp.example.com/mcp",
    }).toString()),
    rawContentType: "application/x-www-form-urlencoded",
  });
  expect(refreshed.status).toBe(200);
  expect(refreshed.body).toMatchObject({ token_type: "Bearer", scope: "files:read" });
  const revoked = await niceBackendFetch(providerUrl(projectId, "/token/revocation"), {
    method: "POST",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      token: refreshed.body.refresh_token,
      client_id: "testClient",
    }).toString()),
    rawContentType: "application/x-www-form-urlencoded",
  });
  expect(revoked.status).toBe(200);
  const afterRevocation = await niceBackendFetch(providerUrl(projectId, "/token"), {
    method: "POST",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshed.body.refresh_token,
      client_id: "testClient",
      resource: "https://mcp.example.com/mcp",
    }).toString()),
    rawContentType: "application/x-www-form-urlencoded",
  });
  expect(afterRevocation.status).toBe(400);
});

it("rejects an approved scope that was not requested", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  const { interactionUid } = await startProjectInteraction(projectId);
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read", "files:write"], denied: false },
  });
  expect(decision.status).toBe(400);
  expect(decision.body).toMatchInlineSnapshot(`"The selected permissions are not part of this authorization request."`);
});

it("filters a requested custom scope that is not allowed for the selected resource", async () => {
  const projectId = await createConfiguredProject({ includeWriteScope: true });
  await Auth.fastSignUp();
  const { interactionUid } = await startProjectInteraction(projectId, "openid files:write");
  const details = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    accessType: "client",
  });
  expect(details.status).toBe(200);
  expect(details.body.scopes).toEqual(expect.arrayContaining([
    expect.objectContaining({ scope: "openid" }),
    expect.objectContaining({ scope: "files:write" }),
  ]));
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:write"], denied: false },
  });
  expect(decision.status).toBe(400);
  expect(decision.body).toMatchInlineSnapshot(`"The selected permissions are not allowed for this resource."`);
});

it("denies an interaction and rejects replay of its consumed decision", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  const { interactionUid, providerCookie } = await startProjectInteraction(projectId);
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: [], denied: true },
  });
  expect(decision.status).toBe(200);
  const completed = await niceBackendFetch(decision.body.done_url, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(completed.status).toBe(303);
  const resumed = await niceBackendFetch(completed.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: updateCookiesFromResponse(providerCookie, completed) },
  });
  expect(resumed.status).toBe(303);
  const callback = new URL(resumed.headers.get("location") ?? "");
  expect(callback.searchParams.get("error")).toBe("access_denied");
  const replay = await niceBackendFetch(decision.body.done_url, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(replay.status).toBe(400);
});

it("rejects an expired or unavailable interaction before provider resume", async () => {
  const projectId = await createConfiguredProject();
  const response = await niceBackendFetch(providerUrl(projectId, "/interaction/expired-interaction/done"), {
    redirect: "manual",
    headers: { accept: "application/json" },
  });
  expect(response.status).toBe(400);
});

it("rejects completion with a different interaction cookie", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  const first = await startProjectInteraction(projectId);
  const second = await startProjectInteraction(projectId);
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${first.interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(decision.status).toBe(200);
  const completed = await niceBackendFetch(decision.body.done_url, {
    redirect: "manual",
    headers: { cookie: second.providerCookie },
  });
  expect(completed.status).toBe(400);
});

it("rejects a decision submitted by a different user", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  const { interactionUid } = await startProjectInteraction(projectId);
  const firstDecision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(firstDecision.status).toBe(200);
  await Auth.fastSignUp();
  const secondDecision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(secondDecision.status).toBe(400);
  expect(secondDecision.body).toMatchInlineSnapshot(`"This authorization request is not available for this user."`);
});

it("marks trusted clients so the hosted flow can skip consent", async () => {
  const projectId = await createConfiguredProject({ trustedClient: true });
  await Auth.fastSignUp();
  const authorize = await niceBackendFetch(providerUrl(projectId, "/auth"), {
    redirect: "manual",
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
      scope: "openid files:read",
      resource: "https://mcp.example.com/mcp",
      code_challenge: oauthCodeChallenge,
      code_challenge_method: "S256",
    },
  });
  expect(authorize.status).toBe(303);
  const providerCookie = updateCookiesFromResponse("", authorize);
  const interaction = await niceBackendFetch(authorize.headers.get("location") ?? "", {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(interaction.status).toBe(307);
  const interactionUid = new URL(authorize.headers.get("location") ?? "").pathname.split("/").at(-1) ?? "";
  const details = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    accessType: "client",
  });
  expect(details.body.trusted_client).toBe(true);
});

it("rejects invalid resources with an OAuth error and consumes each fresh code safely", async () => {
  const projectId = await createConfiguredProject();
  await Auth.fastSignUp();
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = await getProjectAuthorizationCode(projectId);
    const token = await niceBackendFetch(providerUrl(projectId, "/token"), {
      method: "POST",
      headers: { accept: "text/html" },
      rawBody: new TextEncoder().encode(new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: "testClient",
        redirect_uri: "http://localhost:30000/callback",
        code_verifier: oauthCodeVerifier,
        resource: "https://invalid.example.com/mcp",
      }).toString()),
      rawContentType: "application/x-www-form-urlencoded",
    });
    expect(token.status).toBe(400);
    expect(token.headers.get("content-type")).toContain("application/json");
    expect(token.body).toMatchObject({ error: "invalid_target" });
  }
});
