import { STACK_BACKEND_BASE_URL, it, updateCookiesFromResponse } from "../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../backend-helpers";
import { createMcpTokenVerifier } from "@hexclave/js/mcp";
import * as jose from "jose";
import { createHash, randomBytes } from "node:crypto";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

it("does not expose an unconfigured project OAuth provider", async ({ expect }) => {
  const { projectId } = await Project.createAndSwitch();
  const providerBaseUrl = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();

  const discoveryResponse = await niceBackendFetch(`${providerBaseUrl}/.well-known/openid-configuration`);
  expect(discoveryResponse.status).toBe(404);

  const authorizationServerResponse = await niceBackendFetch(`${providerBaseUrl}/.well-known/oauth-authorization-server`);
  expect(authorizationServerResponse.status).toBe(404);

  const jwksResponse = await niceBackendFetch(`${providerBaseUrl}/.well-known/jwks.json`);
  expect(jwksResponse.status).toBe(404);

  const authorizeResponse = await niceBackendFetch(`${providerBaseUrl}/authorize`);
  expect(authorizeResponse.status).toBe(404);
});

it("advertises the project issuer and issuer-derived JWKS URL", async ({ expect }) => {
  const { projectId, adminAccessToken } = await Project.createAndSwitch();
  const resourceUri = "https://mcp.example.com/mcp";

  const configResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      "x-stack-admin-access-token": adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        oauthProvider: {
          resources: {
            mcp: {
              uri: resourceUri,
            },
          },
          clients: {
            mcp: {
              displayName: "MCP client",
              trusted: true,
              redirectUris: {
                callback: {
                  url: "http://127.0.0.1:8765/callback",
                },
              },
            },
          },
        },
      }),
    },
  });
  expect(configResponse.status).toBe(200);

  const issuer = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const discoveryResponse = await niceBackendFetch(`${issuer}/.well-known/openid-configuration`);
  expect(discoveryResponse.status).toBe(200);
  expect(discoveryResponse.body.issuer).toBe(issuer);
  expect(discoveryResponse.body.jwks_uri).toBe(jwksUrl);

  const authorizationServerResponse = await niceBackendFetch(`${issuer}/.well-known/oauth-authorization-server`);
  expect(authorizationServerResponse.status).toBe(200);
  expect(authorizationServerResponse.body.issuer).toBe(issuer);
  expect(authorizationServerResponse.body.jwks_uri).toBe(jwksUrl);

  const jwksResponse = await niceBackendFetch(`${issuer}/.well-known/jwks.json`);
  expect(jwksResponse.status).toBe(200);
  expect(jwksResponse.body.keys.length).toBeGreaterThan(0);

  const advertisedJwksResponse = await niceBackendFetch(discoveryResponse.body.jwks_uri);
  expect(advertisedJwksResponse.status).toBe(200);
  expect(advertisedJwksResponse.body.keys).toEqual(jwksResponse.body.keys);

  const legacyJwksResponse = await niceBackendFetch(`${issuer}/jwks`);
  expect(legacyJwksResponse.status).toBe(404);
});

it("completes an MCP-style authorization-code PKCE flow and verifies the resource-bound token", async ({ expect }) => {
  const { projectId, adminAccessToken } = await Project.createAndSwitch();
  const resourceUri = "https://mcp.example.com/mcp";
  const redirectUri = "http://127.0.0.1:8765/callback";
  const configResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    headers: {
      "x-stack-admin-access-token": adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        oauthProvider: {
          resources: {
            mcp: {
              uri: resourceUri,
              scopes: {
                read: { scope: "mcp:read" },
                missing: { scope: "perm:missing" },
                team: { scope: "team_perm:team-missing" },
              },
            },
          },
          clients: {
            mcp: {
              displayName: "MCP client",
              redirectUris: {
                callback: { url: redirectUri },
              },
            },
          },
        },
        rbac: {
          permissions: {
            missing: {
              scope: "project",
            },
          },
        },
      }),
    },
  });
  expect(configResponse.status).toBe(200);

  const { userId } = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const accessToken = (await import("../../../backend-helpers")).backendContext.value.userAuth?.accessToken
    ?? throwErr("Missing project user access token");
  expect(userId).toEqual(expect.any(String));

  const issuer = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const authorizationResponse = await niceBackendFetch(`${issuer}/authorize`, {
    method: "GET",
    accessType: null,
    redirect: "manual",
    query: {
      client_id: "mcp",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile mcp:read",
      resource: resourceUri,
      state: "mcp-state",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    },
  });
  expect(authorizationResponse.status).toBeGreaterThanOrEqual(300);
  expect(authorizationResponse.status).toBeLessThan(400);
  let interactionCookies = updateCookiesFromResponse("", authorizationResponse);
  const hostedUrl = new URL(authorizationResponse.headers.get("location") ?? throwErr("Missing hosted interaction redirect"));
  const interactionUid = hostedUrl.searchParams.get("interaction_uid") ?? throwErr("Missing interaction UID");
  const approvalResponse = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-approval`, {
    method: "POST",
    accessType: "client",
    userAuth: { accessToken },
    body: { interaction_uid: interactionUid },
  });
  expect(approvalResponse.status).toBe(200);
  const oneTimeCode = typeof approvalResponse.body.code === "string"
    ? approvalResponse.body.code
    : throwErr("Missing interaction approval code");

  const completionResponse = await niceBackendFetch(`${issuer}/interaction/${encodeURIComponent(interactionUid)}/done`, {
    accessType: null,
    redirect: "manual",
    headers: {
      cookie: interactionCookies,
    },
    query: { code: oneTimeCode },
  });
  expect(completionResponse.status).toBeGreaterThanOrEqual(300);
  expect(completionResponse.status).toBeLessThan(400);
  interactionCookies = updateCookiesFromResponse(interactionCookies, completionResponse);
  const completionLocation = completionResponse.headers.get("location") ?? throwErr("Missing client callback redirect");
  expect(completionLocation).toContain(`/authorize/${interactionUid}`);
  let callbackUrl = new URL(`${issuer}/authorize/${interactionUid}`);
  if (callbackUrl.origin === new URL(STACK_BACKEND_BASE_URL).origin) {
    const resumeResponse = await niceBackendFetch(callbackUrl.toString(), {
      accessType: null,
      redirect: "manual",
      headers: { cookie: interactionCookies },
    });
    expect(resumeResponse.status).toBeGreaterThanOrEqual(300);
    expect(resumeResponse.status).toBeLessThan(400);
    callbackUrl = new URL(resumeResponse.headers.get("location") ?? throwErr("Missing client callback redirect"));
  }
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
  expect(callbackUrl.searchParams.get("state")).toBe("mcp-state");
  const authorizationCode = callbackUrl.searchParams.get("code") ?? throwErr("Missing authorization code");

  const tokenResponse = await niceBackendFetch(`${issuer}/token`, {
    method: "POST",
    accessType: null,
    rawContentType: "application/x-www-form-urlencoded",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: "mcp",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource: resourceUri,
    }).toString()),
  });
  expect(tokenResponse.status).toBe(200);
  expect(tokenResponse.body.access_token).toEqual(expect.any(String));
  const decodedToken = jose.decodeJwt(tokenResponse.body.access_token);
  expect(decodedToken.iss).toBe(issuer);
  expect(decodedToken.resource).toBe(resourceUri);
  expect(decodedToken.aud).toBe(`${projectId}:resource:mcp`);
  expect(decodedToken.scope).toContain("mcp:read");
  expect(decodedToken.scope).not.toContain("openid");
  expect(decodedToken.scope).not.toContain("profile");
  expect(decodedToken.scope).not.toContain("perm:missing");
  expect(decodedToken.scope).not.toContain("team_perm:team-missing");

  const verifier = createMcpTokenVerifier({
    projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    resource: resourceUri,
  });
  await expect(verifier.verifyAccessToken(tokenResponse.body.access_token)).resolves.toMatchObject({
    resource: new URL(resourceUri),
    extra: {
      userId,
    },
  });
  const wrongResourceVerifier = createMcpTokenVerifier({
    projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    resource: "https://other-mcp.example.com/mcp",
  });
  await expect(wrongResourceVerifier.verifyAccessToken(tokenResponse.body.access_token)).rejects.toThrow();

  const replayResponse = await niceBackendFetch(`${issuer}/interaction/${encodeURIComponent(interactionUid)}/done`, {
    method: "POST",
    accessType: null,
    redirect: "manual",
    headers: { cookie: interactionCookies },
    query: { code: oneTimeCode },
  });
  expect(replayResponse.status).toBe(400);
});

it("rejects an unknown resource at the authorization endpoint", async ({ expect }) => {
  const { projectId, adminAccessToken } = await Project.createAndSwitch();
  const redirectUri = "http://127.0.0.1:8765/callback";
  const configResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    headers: { "x-stack-admin-access-token": adminAccessToken },
    body: {
      config_override_string: JSON.stringify({
        oauthProvider: {
          clients: {
            mcp: {
              displayName: "MCP client",
              redirectUris: { callback: { url: redirectUri } },
            },
          },
        },
      }),
    },
  });
  expect(configResponse.status).toBe(200);
  const issuer = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
  const response = await niceBackendFetch(`${issuer}/authorize`, {
    accessType: null,
    redirect: "manual",
    query: {
      client_id: "mcp",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      resource: "https://unknown.example.com/mcp",
      code_challenge: "xf6HY7PIgoaCf_eMniSt-45brYE2J_05C9BnfIbueik",
      code_challenge_method: "S256",
    },
  });
  if (response.status === 400) {
    expect(response.body.error).toBe("invalid_target");
  } else {
    expect(response.status).toBe(303);
    const errorRedirect = new URL(response.headers.get("location") ?? throwErr("Missing OAuth error redirect"));
    expect(errorRedirect.searchParams.get("error")).toBe("invalid_target");
  }
});

it("redirects a cancelled authorization with access_denied and cannot exchange a token", async ({ expect }) => {
  const { projectId, adminAccessToken } = await Project.createAndSwitch();
  const redirectUri = "http://127.0.0.1:8765/callback";
  const configResponse = await niceBackendFetch("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    headers: { "x-stack-admin-access-token": adminAccessToken },
    body: {
      config_override_string: JSON.stringify({
        oauthProvider: {
          clients: {
            mcp: {
              displayName: "MCP client",
              redirectUris: { callback: { url: redirectUri } },
            },
          },
        },
      }),
    },
  });
  expect(configResponse.status).toBe(200);
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  const accessToken = (await import("../../../backend-helpers")).backendContext.value.userAuth?.accessToken
    ?? throwErr("Missing project user access token");
  const issuer = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
  const authorizationResponse = await niceBackendFetch(`${issuer}/authorize`, {
    accessType: null,
    redirect: "manual",
    query: {
      client_id: "mcp",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      code_challenge: "xf6HY7PIgoaCf_eMniSt-45brYE2J_05C9BnfIbueik",
      code_challenge_method: "S256",
      state: "cancel-state",
    },
  });
  expect(authorizationResponse.status).toBe(303);
  const hostedUrl = new URL(authorizationResponse.headers.get("location") ?? throwErr("Missing interaction redirect"));
  const interactionUid = hostedUrl.searchParams.get("interaction_uid") ?? throwErr("Missing interaction UID");
  const cancellationResponse = await niceBackendFetch(
    `${issuer}/interaction/${encodeURIComponent(interactionUid)}/done`,
    {
      accessType: null,
      redirect: "manual",
      query: { error: "access_denied" },
    },
  );
  expect(cancellationResponse.status).toBe(303);
  const callbackUrl = new URL(cancellationResponse.headers.get("location") ?? throwErr("Missing cancellation redirect"));
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(redirectUri);
  expect(callbackUrl.searchParams.get("error")).toBe("access_denied");
  expect(callbackUrl.searchParams.get("state")).toBe("cancel-state");
  expect(callbackUrl.searchParams.get("code")).toBeNull();

  const approvalAfterDenial = await niceBackendFetch(`/api/v1/projects/${projectId}/oauth-approval`, {
    method: "POST",
    accessType: "client",
    userAuth: { accessToken },
    body: { interaction_uid: interactionUid },
  });
  expect(approvalAfterDenial.status).toBe(400);

  const tokenResponse = await niceBackendFetch(`${issuer}/token`, {
    method: "POST",
    accessType: null,
    rawContentType: "application/x-www-form-urlencoded",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "authorization_code",
      code: "cancelled-authorization-code",
      client_id: "mcp",
      redirect_uri: redirectUri,
      code_verifier: "cancelled-code-verifier",
    }).toString()),
  });
  expect(tokenResponse.status).toBe(400);
});

it("does not redirect a bogus cancelled interaction to an attacker URI", async ({ expect }) => {
  const { projectId } = await Project.createAndSwitch();
  const issuer = new URL(`/api/v1/projects/${projectId}/oidc`, STACK_BACKEND_BASE_URL).toString();
  const response = await niceBackendFetch(
    `${issuer}/interaction/unknown-interaction/done`,
    {
      accessType: null,
      redirect: "manual",
      query: {
        error: "access_denied",
        redirect_uri: "https://attacker.example/steal",
      },
    },
  );
  expect([400, 404]).toContain(response.status);
  expect(response.headers.get("location")).toBeNull();
});
