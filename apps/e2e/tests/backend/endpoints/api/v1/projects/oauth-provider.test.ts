import { expect } from "vitest";
import { it, STACK_BACKEND_BASE_URL } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

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
      code_challenge: "challenge",
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
