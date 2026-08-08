import { createHash } from "node:crypto";
import { createMcpTokenVerifier } from "@hexclave/js/mcp";
import { expect } from "vitest";
import { it, STACK_BACKEND_BASE_URL, updateCookiesFromResponse } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

const oauthCodeVerifier = "a".repeat(43);
const oauthCodeChallenge = createHash("sha256").update(oauthCodeVerifier).digest("base64url");

async function createConfiguredProject() {
  const { projectId } = await Project.createAndSwitch();
  await Project.pushConfig({
    oauthProvider: {
      scopes: {
        filesRead: {
          scope: "files:read",
          displayName: "Read files",
        },
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

it("rejects unknown clients and authorization requests without PKCE", async () => {
  const projectId = await createConfiguredProject();
  const unknownClient = await niceBackendFetch(providerUrl(projectId, "/auth"), {
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
    allow_user_to_deselect_optional_scopes: true,
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

it("completes the project OAuth authorization code flow", async () => {
  const projectId = await createConfiguredProject();
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
  const interactionLocation = authorize.headers.get("location") ?? "";
  const interaction = await niceBackendFetch(interactionLocation, {
    redirect: "manual",
    headers: { cookie: providerCookie },
  });
  expect(interaction.status).toBe(307);
  const interactionUid = new URL(interactionLocation).pathname.split("/").at(-1) ?? "";
  const decision = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-provider/interaction/${interactionUid}`, {
    method: "POST",
    accessType: "client",
    body: { approved_scopes: ["openid", "files:read"], denied: false },
  });
  expect(decision.status).toBe(200);
  const completed = await niceBackendFetch(decision.body.done_url, {
    method: "POST",
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
});
