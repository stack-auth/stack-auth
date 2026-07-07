import { urlString } from "@hexclave/shared/dist/utils/urls";
import { describe, expect } from "vitest";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

const agentAuthEnabledConfig = {
  "apps.installed.agent-auth": {
    enabled: true,
  },
  "agentAuth.identityTypes.serviceAuth": true,
  "agentAuth.identityTypes.anonymous": true,
} as const;

function normalizeProjectUrls(value: string, projectId: string) {
  return value.replaceAll(projectId, "<project_id>");
}

function normalizeDiscoveryBody(body: {
  resource: string,
  resource_name: string,
  authorization_servers: string[],
  scopes_supported: string[],
  bearer_methods_supported: string[],
  agent_auth?: { skill: string, identity_endpoint: string, claim_endpoint: string, events_endpoint: string, identity_types_supported: string[], events_supported: string[] },
}, projectId: string) {
  return {
    ...body,
    resource: normalizeProjectUrls(body.resource, projectId),
    authorization_servers: body.authorization_servers.map((value) => normalizeProjectUrls(value, projectId)),
    ...(body.agent_auth == null ? {} : {
      agent_auth: {
        ...body.agent_auth,
        skill: normalizeProjectUrls(body.agent_auth.skill, projectId),
        identity_endpoint: normalizeProjectUrls(body.agent_auth.identity_endpoint, projectId),
        claim_endpoint: normalizeProjectUrls(body.agent_auth.claim_endpoint, projectId),
        events_endpoint: normalizeProjectUrls(body.agent_auth.events_endpoint, projectId),
      },
    }),
  };
}

function getClaimAttemptTokenFromVerificationUri(verificationUri: string) {
  const url = new URL(verificationUri);
  const claimAttemptToken = url.searchParams.get("claim_attempt_token");
  if (claimAttemptToken == null) {
    throw new Error(`verification_uri is missing claim_attempt_token: ${verificationUri}`);
  }
  return claimAttemptToken;
}

async function createProject() {
  const { projectId, adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      allow_user_api_keys: false,
      allow_team_api_keys: false,
    },
  });
  backendContext.set({
    projectKeys: {
      ...backendContext.value.projectKeys,
      adminAccessToken,
    },
  });
  return { projectId, adminAccessToken };
}

async function enableAgentAuth(adminAccessToken: string, extraConfig: Record<string, unknown> = {}) {
  const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
    accessType: "admin",
    method: "PATCH",
    headers: {
      "x-stack-admin-access-token": adminAccessToken,
    },
    body: {
      config_override_string: JSON.stringify({
        ...agentAuthEnabledConfig,
        ...extraConfig,
      }),
    },
  });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true });
}

async function registerAnonymous(projectId: string) {
  return await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity`, {
    method: "POST",
    accessType: "client",
    body: {
      type: "anonymous",
    },
  });
}

async function registerServiceAuth(projectId: string, loginHint: string) {
  return await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity`, {
    method: "POST",
    accessType: "client",
    body: {
      type: "service_auth",
      login_hint: loginHint,
    },
  });
}

async function pollClaimToken(projectId: string, claimToken: string) {
  return await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/token`, {
    method: "POST",
    accessType: "client",
    body: {
      grant_type: "urn:workos:agent-auth:grant-type:claim",
      claim_token: claimToken,
    },
  });
}

describe("agent auth vertical slice", () => {
  it("handles discovery enablement and disablement", async ({ expect }) => {
    const { projectId } = await createProject();

    const disabledDiscoveryResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/.well-known/oauth-protected-resource`, {
      accessType: "client",
    });
    expect(disabledDiscoveryResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": "Project not found",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const disabledAuthorizationResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/.well-known/oauth-authorization-server`, {
      accessType: "client",
    });
    expect(disabledAuthorizationResponse.status).toBe(404);

    const disabledAuthMdResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/auth.md`, {
      accessType: "client",
    });
    expect(disabledAuthMdResponse.status).toBe(404);

    await enableAgentAuth((backendContext.value.projectKeys as { adminAccessToken: string }).adminAccessToken);

    const discoveryResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/.well-known/oauth-protected-resource`, {
      accessType: "client",
    });
    expect(discoveryResponse.status).toBe(200);
    expect(normalizeDiscoveryBody(discoveryResponse.body, projectId)).toMatchInlineSnapshot(`
      {
        "authorization_servers": ["http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>"],
        "bearer_methods_supported": ["header"],
        "resource": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>",
        "resource_name": "New Project",
        "scopes_supported": ["agent.auth"],
      }
    `);

    const authorizationResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/.well-known/oauth-authorization-server`, {
      accessType: "client",
    });
    expect(authorizationResponse.status).toBe(200);
    expect(normalizeDiscoveryBody(authorizationResponse.body, projectId)).toMatchInlineSnapshot(`
      {
        "agent_auth": {
          "claim_endpoint": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>/agent/identity/claim",
          "events_endpoint": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>/agent/event/notify",
          "events_supported": ["https://schemas.workos.com/events/agent/auth/identity/assertion/revoked"],
          "identity_endpoint": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>/agent/identity",
          "identity_types_supported": [
            "anonymous",
            "service_auth",
          ],
          "skill": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>/auth.md",
        },
        "authorization_servers": ["http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>"],
        "bearer_methods_supported": ["header"],
        "grant_types_supported": [
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
          "urn:workos:agent-auth:grant-type:claim",
        ],
        "issuer": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<stripped UUID>",
        "resource": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<project_id>",
        "resource_name": "New Project",
        "revocation_endpoint": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<stripped UUID>/agent/revoke",
        "scopes_supported": ["agent.auth"],
        "token_endpoint": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>02/api/v1/projects/<stripped UUID>/agent/token",
      }
    `);

    const authMdResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/auth.md`, {
      accessType: "client",
    });
    expect(authMdResponse.status).toBe(200);
    expect(String(authMdResponse.body)).toContain("/agent/identity");
    expect(String(authMdResponse.body)).toContain("/agent/api-keys");
  });

  it("returns config-toggle errors for disabled identity types", async ({ expect }) => {
    const { projectId, adminAccessToken } = await createProject();
    await enableAgentAuth(adminAccessToken, {
      "agentAuth.identityTypes.serviceAuth": false,
      "agentAuth.identityTypes.anonymous": false,
    });

    const serviceAuthResponse = await registerServiceAuth(projectId, "agent@example.com");
    expect(serviceAuthResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": { "error": "service_auth_not_enabled" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const anonymousResponse = await registerAnonymous(projectId);
    expect(anonymousResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": { "error": "anonymous_not_enabled" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("supports the anonymous claim and jwt-bearer exchange flow", async ({ expect }) => {
    const { projectId, adminAccessToken } = await createProject();
    await enableAgentAuth(adminAccessToken);

    const registrationResponse = await registerAnonymous(projectId);
    expect(registrationResponse.status).toBe(200);
    expect(registrationResponse.body).toMatchObject({
      registration: {
        type: "anonymous",
        status: "pending",
      },
      identity_assertion: expect.any(String),
      access_token: expect.any(String),
      claim_token: expect.any(String),
      pre_claim_scopes: ["agent.auth"],
      post_claim_scopes: ["agent.auth"],
    });

    backendContext.set({
      userAuth: {
        accessToken: registrationResponse.body.access_token as string,
        refreshToken: registrationResponse.body.identity_assertion as string,
      },
    });

    const meResponse = await niceBackendFetch("/api/v1/users/me", {
      accessType: "client",
    });
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.is_anonymous).toBe(true);

    const exchangeResponse = await pollClaimToken(projectId, registrationResponse.body.claim_token as string);
    expect(exchangeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "error": "authorization_pending",
          "interval": 5,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const jwtBearerResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/token`, {
      method: "POST",
      accessType: "client",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: registrationResponse.body.identity_assertion,
      },
    });
    expect(jwtBearerResponse.status).toBe(200);
    expect(jwtBearerResponse.body).toMatchObject({
      token_type: "Bearer",
      access_token: expect.any(String),
      identity_assertion: registrationResponse.body.identity_assertion,
      scope: "agent.auth",
    });
  });

  it("completes the service-auth claim ceremony and supports claim security", async ({ expect }) => {
    const { projectId, adminAccessToken } = await createProject();
    await enableAgentAuth(adminAccessToken);

    const loginHintMailbox = createMailbox();
    const registrationResponse = await registerServiceAuth(projectId, loginHintMailbox.emailAddress);
    expect(registrationResponse.status).toBe(200);
    const claimAttemptToken = getClaimAttemptTokenFromVerificationUri(registrationResponse.body.claim.verification_uri);
    expect(registrationResponse.body.claim).toMatchObject({
      user_code: expect.any(String),
      verification_uri: expect.stringContaining(`/projects/${projectId}/agent-auth-app/claim`),
      interval: 5,
      expires_in: 600,
    });

    await Auth.fastSignUp({
      primary_email: loginHintMailbox.emailAddress,
      primary_email_verified: true,
    });

    const wrongCodeResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity/claim/complete`, {
      method: "POST",
      accessType: "client",
      body: {
        claim_attempt_token: claimAttemptToken,
        user_code: "000000",
      },
    });
    expect(wrongCodeResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": { "error": "invalid_claim_token" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const wrongUserMailbox = createMailbox();
    await Auth.fastSignUp({
      primary_email: wrongUserMailbox.emailAddress,
      primary_email_verified: true,
    });

    const wrongEmailResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity/claim/complete`, {
      method: "POST",
      accessType: "client",
      body: {
        claim_attempt_token: claimAttemptToken,
        user_code: registrationResponse.body.claim.user_code,
      },
    });
    expect(wrongEmailResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 403,
        "body": { "error": "access_denied" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    await Auth.fastSignUp({
      primary_email: loginHintMailbox.emailAddress,
      primary_email_verified: true,
    });

    const completeResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity/claim/complete`, {
      method: "POST",
      accessType: "client",
      body: {
        claim_attempt_token: claimAttemptToken,
        user_code: registrationResponse.body.claim.user_code,
      },
    });
    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body).toMatchObject({
      success: true,
      access_token: expect.any(String),
      identity_assertion: expect.any(String),
      assertion_expires: expect.any(String),
    });

    backendContext.set({
      userAuth: {
        accessToken: completeResponse.body.access_token as string,
        refreshToken: completeResponse.body.identity_assertion as string,
      },
    });

    const claimPollResponse = await pollClaimToken(projectId, registrationResponse.body.claim_token as string);
    expect(claimPollResponse.status).toBe(200);
    expect(claimPollResponse.body).toMatchObject({
      token_type: "Bearer",
      scope: "agent.auth",
      access_token: expect.any(String),
      identity_assertion: expect.any(String),
      assertion_expires: expect.any(String),
      expires_in: expect.any(Number),
    });
  });

  it("issues API keys after the ceremony and reports app-disabled errors", async ({ expect }) => {
    const { projectId, adminAccessToken } = await createProject();
    await enableAgentAuth(adminAccessToken);

    const email = createMailbox().emailAddress;
    const registrationResponse = await registerServiceAuth(projectId, email);
    const claimAttemptToken = getClaimAttemptTokenFromVerificationUri(registrationResponse.body.claim.verification_uri);

    await Auth.fastSignUp({
      primary_email: email,
      primary_email_verified: true,
    });

    const completeResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/identity/claim/complete`, {
      method: "POST",
      accessType: "client",
      body: {
        claim_attempt_token: claimAttemptToken,
        user_code: registrationResponse.body.claim.user_code,
      },
    });
    expect(completeResponse.status).toBe(200);

    backendContext.set({
      userAuth: {
        accessToken: completeResponse.body.access_token as string,
        refreshToken: completeResponse.body.identity_assertion as string,
      },
    });

    const disabledApiKeysResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/api-keys`, {
      method: "POST",
      accessType: "client",
      body: {
        description: "Agent API key",
        expires_at_millis: null,
      },
    });
    expect(disabledApiKeysResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 403,
        "body": {
          "enable_url": "http://localhost:<$NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX>01/projects/<stripped UUID>/api-keys-app",
          "error": "api_keys_app_not_enabled",
          "error_description": "Agent API key issuance is not enabled for this project.",
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    await Project.updateCurrent(adminAccessToken, {
      config: {
        allow_user_api_keys: true,
      },
    });
    await enableAgentAuth(adminAccessToken, {
      "apps.installed.api-keys": {
        enabled: true,
      },
    });

    const enabledApiKeysResponse = await niceBackendFetch(urlString`/api/v1/projects/${projectId}/agent/api-keys`, {
      method: "POST",
      accessType: "client",
      body: {
        description: "Agent API key",
        expires_at_millis: null,
      },
    });
    expect(enabledApiKeysResponse.status).toBe(200);
    expect(enabledApiKeysResponse.body).toMatchObject({
      description: "Agent API key",
      is_public: false,
      type: "user",
      value: expect.any(String),
      user_id: expect.any(String),
    });

  });
});
