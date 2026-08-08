import { expect } from "vitest";
import { it, STACK_BACKEND_BASE_URL } from "../../../../../helpers";
import { Project, Auth, niceBackendFetch } from "../../../../backend-helpers";

async function createConfiguredProject() {
  await Auth.fastSignUp();
  const { projectId } = await Project.create();
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
      "scopes_supported": ["address", "email", "files:read", "offline_access", "openid", "phone", "profile"],
      "token_endpoint": "<issuer>/token",
    }
  `);

  const oauthConfiguration = await niceBackendFetch(providerUrl(projectId, "/.well-known/oauth-authorization-server"));
  expect(oauthConfiguration.status).toBe(200);
  expect({
    issuer: normalizeIssuerUrl(oauthConfiguration.body.issuer, issuer),
    authorization_endpoint: normalizeIssuerUrl(oauthConfiguration.body.authorization_endpoint, issuer),
    token_endpoint: normalizeIssuerUrl(oauthConfiguration.body.token_endpoint, issuer),
    registration_endpoint: normalizeIssuerUrl(oauthConfiguration.body.registration_endpoint, issuer),
    revocation_endpoint: normalizeIssuerUrl(oauthConfiguration.body.revocation_endpoint, issuer),
    jwks_uri: normalizeIssuerUrl(oauthConfiguration.body.jwks_uri, issuer),
    code_challenge_methods_supported: oauthConfiguration.body.code_challenge_methods_supported,
  }).toMatchInlineSnapshot(`
    {
      "authorization_endpoint": "<issuer>/auth",
      "code_challenge_methods_supported": ["S256"],
      "issuer": "<issuer>",
      "jwks_uri": "<issuer>/.well-known/jwks.json",
      "registration_endpoint": "<issuer>/reg",
      "revocation_endpoint": "<issuer>/token/revocation",
      "token_endpoint": "<issuer>/token",
    }
  `);

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
});

it("returns a safe 404 for an unknown project", async () => {
  const response = await niceBackendFetch("/api/v1/projects/00000000-0000-4000-8000-000000000000/oidc/.well-known/openid-configuration");
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": { "message": "Project not found" },
      "headers": Headers { <some fields may be hidden> },
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
    query: {
      response_type: "code",
      client_id: "testClient",
      redirect_uri: "http://localhost:30000/callback",
    },
  });
  expect(missingPkce.status).toBe(400);
  expect(missingPkce.body).toMatchObject({ error: "invalid_request" });
});
