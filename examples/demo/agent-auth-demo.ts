#!/usr/bin/env node

type ProjectKeys = {
  projectId: string;
  publishableClientKey: string;
  secretServerKey: string;
  superSecretAdminKey: string;
};

type DemoProjectContext = ProjectKeys & {
  adminAccessToken: string;
};

type RequestOptions = {
  method?: string;
  accessType?: "client" | "server" | "admin";
  body?: unknown;
  headers?: Record<string, string>;
  project?: ProjectKeys | undefined;
  accessToken?: string;
  refreshToken?: string;
};

type JsonResponse<T> = {
  status: number;
  body: T;
  headers: Headers;
};

type SignUpResponse = {
  access_token: string;
  refresh_token: string;
  user_id: string;
};

type CreatedProjectResponse = {
  id: string;
};

type ProjectApiKeyResponse = {
  publishable_client_key: string;
  secret_server_key: string;
  super_secret_admin_key: string;
};

type ClaimCompletionResponse = {
  access_token: string;
  refresh_token: string;
  user_id: string;
};

type AgentIdentityRegistrationResponse = {
  registration: {
    type: "anonymous" | "service_auth";
    status: string;
  };
  claim_token: string;
  identity_assertion?: string;
  access_token?: string;
  claim?: {
    claim_attempt_token: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
  };
  pre_claim_scopes?: string[];
  post_claim_scopes?: string[];
};

type ClaimPollResponse = {
  access_token?: string;
  identity_assertion?: string;
  assertion_expires?: number;
  error?: string;
  error_description?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function resolveEnvVar(primary: string, fallback: string): string | undefined {
  const primaryValue = process.env[primary];
  const fallbackValue = process.env[fallback];
  if (primaryValue != null && fallbackValue != null && primaryValue !== fallbackValue) {
    throw new Error(`Environment variables ${primary} and ${fallback} are both set to different values.`);
  }
  return primaryValue ?? fallbackValue;
}

function resolveAnyEnv(...names: string[]) {
  let resolved: string | undefined;
  for (const name of names) {
    const value = process.env[name];
    if (value == null) {
      continue;
    }
    if (resolved != null && resolved !== value) {
      throw new Error(`Environment variables ${names.join(", ")} are both set to different values.`);
    }
    resolved = value;
  }
  return resolved;
}

function requiredEnv(name: string, fallback?: string): string {
  const value = fallback == null ? process.env[name] : resolveEnvVar(name, fallback);
  if (value == null || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}${fallback == null ? "" : ` (or ${fallback})`}`);
  }
  return value;
}

function withPortPrefix() {
  return process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
}

function apiUrl() {
  return resolveEnvVar("HEXCLAVE_API_URL", "STACK_API_URL") ?? `http://localhost:${withPortPrefix()}02`;
}

function dashboardUrl() {
  return resolveEnvVar("HEXCLAVE_APP_URL", "STACK_APP_URL") ?? `http://localhost:${withPortPrefix()}01`;
}

function internalProjectKeys(): ProjectKeys {
  return {
    projectId: resolveAnyEnv("HEXCLAVE_INTERNAL_PROJECT_ID", "STACK_INTERNAL_PROJECT_ID") ?? "internal",
    publishableClientKey: resolveAnyEnv(
      "HEXCLAVE_INTERNAL_PROJECT_CLIENT_KEY",
      "HEXCLAVE_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY",
      "STACK_INTERNAL_PROJECT_CLIENT_KEY",
      "STACK_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY",
    ) ?? "this-publishable-client-key-is-for-local-development-only",
    secretServerKey: resolveAnyEnv(
      "HEXCLAVE_INTERNAL_PROJECT_SERVER_KEY",
      "HEXCLAVE_INTERNAL_PROJECT_SECRET_SERVER_KEY",
      "STACK_INTERNAL_PROJECT_SERVER_KEY",
      "STACK_INTERNAL_PROJECT_SECRET_SERVER_KEY",
    ) ?? "this-secret-server-key-is-for-local-development-only",
    superSecretAdminKey: resolveAnyEnv(
      "HEXCLAVE_INTERNAL_PROJECT_ADMIN_KEY",
      "HEXCLAVE_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY",
      "STACK_INTERNAL_PROJECT_ADMIN_KEY",
      "STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY",
    ) ?? "this-super-secret-admin-key",
  };
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<JsonResponse<T>> {
  const url = new URL(path, apiUrl());
  const headers: Record<string, string> = {
    "x-stack-disable-artificial-development-delay": "yes",
    "x-stack-development-disable-extended-logging": "yes",
  };
  if (options.accessType != null) {
    headers["x-stack-access-type"] = options.accessType;
  }
  if (options.project != null) {
    headers["x-stack-project-id"] = options.project.projectId;
    headers["x-stack-publishable-client-key"] = options.project.publishableClientKey;
    headers["x-stack-secret-server-key"] = options.project.secretServerKey;
    headers["x-stack-super-secret-admin-key"] = options.project.superSecretAdminKey;
  }
  if (options.accessToken != null) {
    headers[options.accessType === "admin" ? "x-stack-admin-access-token" : "x-stack-access-token"] = options.accessToken;
  }
  if (options.refreshToken != null) {
    headers["x-stack-refresh-token"] = options.refreshToken;
  }
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    headers[key] = value;
  }
  let body: BodyInit | undefined;
  if (options.body != null) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  const contentType = response.headers.get("content-type") ?? "";
  let responseBody: T;
  if (contentType.includes("application/json")) {
    responseBody = await response.json() as T;
  } else {
    responseBody = (await response.text()) as T;
  }
  return {
    status: response.status,
    body: responseBody,
    headers: response.headers,
  };
}

function logStep(title: string, details?: string) {
  console.log(`\n=== ${title} ===`);
  if (details != null) {
    console.log(details);
  }
}

function truncate(value: string, length = 24) {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function getClaimAttemptTokenFromVerificationUri(verificationUri: string) {
  const url = new URL(verificationUri);
  const claimAttemptToken = url.searchParams.get("claim_attempt_token");
  if (claimAttemptToken == null) {
    throw new Error(`verification_uri is missing claim_attempt_token: ${verificationUri}`);
  }
  return claimAttemptToken;
}

async function createBootstrapProject(): Promise<DemoProjectContext> {
  logStep("Bootstrap project", "Signing up a creator user in the internal project...");
  const internal = internalProjectKeys();
  const creatorEmail = `agent-demo-${Date.now()}@stack-generated.example.com`;

  const signUpResponse = await requestJson<SignUpResponse>("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    project: internal,
    body: {
      email: creatorEmail,
      password: "agent-demo-password-123",
      verification_callback_url: "http://localhost:12345/some-callback-url",
      bot_challenge_token: "mock-turnstile-ok:sign_up_with_credential",
    },
  });

  if (signUpResponse.status !== 200) {
    throw new Error(`Creator sign-up failed: ${signUpResponse.status} ${JSON.stringify(signUpResponse.body)}`);
  }

  const creatorAccessToken = signUpResponse.body.access_token;

  const creatorMe = await requestJson<{ selected_team_id: string }>("/api/v1/users/me", {
    accessType: "client",
    project: internal,
    accessToken: creatorAccessToken,
  });
  if (creatorMe.status !== 200) {
    throw new Error(`Could not read creator team: ${creatorMe.status} ${JSON.stringify(creatorMe.body)}`);
  }

  const createProjectResponse = await requestJson<CreatedProjectResponse>("/api/v1/internal/projects", {
    method: "POST",
    accessType: "client",
    project: internal,
    accessToken: creatorAccessToken,
    body: {
      display_name: "Agent Auth Demo Project",
      owner_team_id: creatorMe.body.selected_team_id,
      config: {
        credential_enabled: true,
        allow_localhost: true,
      },
    },
  });
  if (createProjectResponse.status !== 201) {
    throw new Error(`Project creation failed: ${createProjectResponse.status} ${JSON.stringify(createProjectResponse.body)}`);
  }

  const demoProject: ProjectKeys = {
    projectId: createProjectResponse.body.id,
    publishableClientKey: "",
    secretServerKey: "",
    superSecretAdminKey: "",
  };

  const projectKeysResponse = await requestJson<ProjectApiKeyResponse>("/api/v1/internal/api-keys", {
    method: "POST",
    accessType: "admin",
    project: { ...internal, projectId: createProjectResponse.body.id },
    accessToken: creatorAccessToken,
    body: {
      description: "agent auth demo project keys",
      has_publishable_client_key: true,
      has_secret_server_key: true,
      has_super_secret_admin_key: true,
      expires_at_millis: Date.now() + 1000 * 60 * 60 * 24,
    },
  });
  if (projectKeysResponse.status !== 200) {
    throw new Error(`Project key creation failed: ${projectKeysResponse.status} ${JSON.stringify(projectKeysResponse.body)}`);
  }

  return {
    ...demoProject,
    publishableClientKey: projectKeysResponse.body.publishable_client_key,
    secretServerKey: projectKeysResponse.body.secret_server_key,
    superSecretAdminKey: projectKeysResponse.body.super_secret_admin_key,
    adminAccessToken: creatorAccessToken,
  };
}

async function ensureProjectContext(): Promise<DemoProjectContext> {
  const targetProjectId = process.env.HEXCLAVE_AGENT_AUTH_DEMO_PROJECT_ID ?? process.env.STACK_AGENT_AUTH_DEMO_PROJECT_ID;
  const targetPublishableClientKey = process.env.HEXCLAVE_AGENT_AUTH_DEMO_PUBLISHABLE_CLIENT_KEY ?? process.env.STACK_AGENT_AUTH_DEMO_PUBLISHABLE_CLIENT_KEY;
  const targetSecretServerKey = process.env.HEXCLAVE_AGENT_AUTH_DEMO_SECRET_SERVER_KEY ?? process.env.STACK_AGENT_AUTH_DEMO_SECRET_SERVER_KEY;
  const targetSuperSecretAdminKey = process.env.HEXCLAVE_AGENT_AUTH_DEMO_SUPER_SECRET_ADMIN_KEY ?? process.env.STACK_AGENT_AUTH_DEMO_SUPER_SECRET_ADMIN_KEY;
  const targetAdminAccessToken = process.env.HEXCLAVE_AGENT_AUTH_DEMO_ADMIN_ACCESS_TOKEN ?? process.env.STACK_AGENT_AUTH_DEMO_ADMIN_ACCESS_TOKEN;

  if (
    targetProjectId != null &&
    targetPublishableClientKey != null &&
    targetSecretServerKey != null &&
    targetSuperSecretAdminKey != null &&
    targetAdminAccessToken != null
  ) {
    return {
      projectId: targetProjectId,
      publishableClientKey: targetPublishableClientKey,
      secretServerKey: targetSecretServerKey,
      superSecretAdminKey: targetSuperSecretAdminKey,
      adminAccessToken: targetAdminAccessToken,
    };
  }

  return await createBootstrapProject();
}

async function ensureAgentAuthEnabled(project: DemoProjectContext) {
  logStep("Enable agent auth", `Project ${project.projectId} → app enablement`);
  const response = await requestJson<Record<string, unknown>>("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    project,
    accessToken: project.adminAccessToken,
    body: {
      config_override_string: JSON.stringify({
        apps: {
          installed: {
            "agent-auth": {
              enabled: true,
            },
          },
        },
        agentAuth: {
          identityTypes: {
            serviceAuth: true,
            anonymous: true,
          },
        },
      }),
    },
  });
  if (response.status >= 400) {
    throw new Error(`Failed to enable agent auth: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

async function enableApiKeys(project: DemoProjectContext) {
  logStep("Enable API keys", `Project ${project.projectId} → app enablement`);
  const appResponse = await requestJson<Record<string, unknown>>("/api/v1/internal/config/override/branch", {
    method: "PATCH",
    accessType: "admin",
    project,
    accessToken: project.adminAccessToken,
    body: {
      config_override_string: JSON.stringify({
        "apps.installed.api-keys": {
          enabled: true,
        },
      }),
    },
  });
  if (appResponse.status >= 400) {
    throw new Error(`Failed to enable api keys app: ${appResponse.status} ${JSON.stringify(appResponse.body)}`);
  }

  const projectResponse = await requestJson<Record<string, unknown>>("/api/v1/internal/projects/current", {
    method: "PATCH",
    accessType: "admin",
    project,
    accessToken: project.adminAccessToken,
    body: {
      config: {
        allow_user_api_keys: true,
      },
    },
  });
  if (projectResponse.status >= 400) {
    throw new Error(`Failed to enable api keys: ${projectResponse.status} ${JSON.stringify(projectResponse.body)}`);
  }
}

async function registerAnonymous(project: ProjectKeys) {
  logStep("Anonymous registration");
  const response = await requestJson<AgentIdentityRegistrationResponse>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/identity", {
    method: "POST",
    accessType: "client",
    project,
    body: {
      type: "anonymous",
    },
  });
  if (response.status !== 200) {
    throw new Error(`Anonymous registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  console.log(`identity_assertion: ${truncate(response.body.identity_assertion ?? "")}`);
  console.log(`claim_token:        ${truncate(response.body.claim_token)}`);
  console.log(`pre-claim scopes:   ${(response.body.pre_claim_scopes ?? []).join(" ")}`);
  return response.body;
}

async function registerServiceAuth(project: ProjectKeys, loginHint: string) {
  logStep("Service auth registration");
  const response = await requestJson<AgentIdentityRegistrationResponse>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/identity", {
    method: "POST",
    accessType: "client",
    project,
    body: {
      type: "service_auth",
      login_hint: loginHint,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Service auth registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  console.log(`user_code:          ${response.body.claim?.user_code}`);
  console.log(`verification_uri:   ${response.body.claim?.verification_uri}`);
  console.log(`claim_attempt_token: ${truncate(getClaimAttemptTokenFromVerificationUri(response.body.claim?.verification_uri ?? ""))}`);
  return response.body;
}

async function completeClaim(project: ProjectKeys, claimAttemptToken: string, userCode: string, accessToken: string) {
  const response = await requestJson<ClaimCompletionResponse>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/identity/claim/complete", {
    method: "POST",
    accessType: "client",
    project,
    accessToken,
    body: {
      claim_attempt_token: claimAttemptToken,
      user_code: userCode,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Claim completion failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function pollClaimToken(project: ProjectKeys, claimToken: string) {
  let tries = 0;
  while (true) {
    tries += 1;
    const response = await requestJson<ClaimPollResponse>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/token", {
      method: "POST",
      accessType: "client",
      project,
      body: {
        grant_type: "urn:workos:agent-auth:grant-type:claim",
        claim_token: claimToken,
      },
    });
    if (response.status === 200 && response.body.access_token != null) {
      console.log(`claim poll succeeded after ${tries} attempt(s)`);
      return response.body;
    }
    if (response.body.error === "authorization_pending" || response.body.error === "slow_down") {
      console.log(`claim poll → ${response.body.error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (response.body.error === "expired_token") {
      throw new Error("Claim token expired before completion");
    }
    throw new Error(`Unexpected claim poll response: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

async function exchangeRefreshToken(project: ProjectKeys, refreshToken: string) {
  const response = await requestJson<ClaimPollResponse>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/token", {
    method: "POST",
    accessType: "client",
    project,
    body: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: refreshToken,
    },
  });
  if (response.status !== 200) {
    throw new Error(`JWT-bearer exchange failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function callAuthedEndpoint(project: ProjectKeys, accessToken: string) {
  const response = await requestJson<Record<string, unknown>>("/api/v1/users/me", {
    accessType: "client",
    project,
    accessToken,
  });
  if (response.status !== 200) {
    throw new Error(`Authenticated request failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function issueApiKey(project: ProjectKeys, accessToken: string) {
  const response = await requestJson<Record<string, unknown>>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/api-keys", {
    method: "POST",
    accessType: "client",
    project,
    accessToken,
    body: {
      description: "Agent Auth demo key",
      expires_at_millis: null,
    },
  });
  return response;
}

async function main() {
  console.log("AuthMD / WorkOS agent-auth demo");
  console.log(`API:       ${apiUrl()}`);
  console.log(`Dashboard: ${dashboardUrl()}`);

  const project = await ensureProjectContext();
  console.log(`\nProject:   ${project.projectId}`);

  await ensureAgentAuthEnabled(project);

  logStep("Discovery");
  const resourceResponse = await requestJson<string>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/.well-known/oauth-protected-resource", {
    accessType: "client",
    project,
  });
  console.log(await requestJson<string>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/auth.md", {
    accessType: "client",
    project,
  }).then((res) => (typeof res.body === "string" ? res.body : JSON.stringify(res.body))).then((body) => body.slice(0, 1200)));
  console.log(`protected_resource_status=${resourceResponse.status}`);

  const anonymous = await registerAnonymous(project);
  const claimExchange = await exchangeRefreshToken(project, anonymous.identity_assertion ?? "");
  console.log(`anonymous access token: ${truncate(claimExchange.access_token ?? "")}`);
  console.log(`jwt-bearer scope:       ${claimExchange.scope ?? ""}`);

  const serviceAuthEmail = `agent-demo-${Date.now()}@stack-generated.example.com`;
  const serviceAuthRegistration = await registerServiceAuth(project, serviceAuthEmail);
  const serviceAuthClaimAttemptToken = getClaimAttemptTokenFromVerificationUri(serviceAuthRegistration.claim?.verification_uri ?? "");
  const matchingUser = await requestJson<{ id: string }>("/api/v1/users", {
    method: "POST",
    accessType: "server",
    project,
    body: {
      display_name: "Agent Auth Demo User",
      primary_email: serviceAuthEmail,
      primary_email_verified: true,
    },
  });
  if (matchingUser.status !== 201) {
    throw new Error(`Matching user creation failed: ${matchingUser.status} ${JSON.stringify(matchingUser.body)}`);
  }
  const matchingSession = await requestJson<SignUpResponse>("/api/v1/auth/sessions", {
    method: "POST",
    accessType: "server",
    project,
    body: {
      user_id: matchingUser.body.id,
    },
  });
  if (matchingSession.status !== 200) {
    throw new Error(`Matching session creation failed: ${matchingSession.status} ${JSON.stringify(matchingSession.body)}`);
  }

  const completed = await completeClaim(project, serviceAuthClaimAttemptToken, serviceAuthRegistration.claim?.user_code ?? "", matchingSession.body.access_token);
  console.log(`claim completed user_id: ${completed.user_id}`);

  const claimPoll = await pollClaimToken(project, serviceAuthRegistration.claim_token);
  console.log(`service_auth access token: ${truncate(claimPoll.access_token ?? "")}`);
  console.log(`identity_assertion:        ${truncate(claimPoll.identity_assertion ?? "")}`);

  const me = await callAuthedEndpoint(project, claimPoll.access_token ?? "");
  console.log(`signed-in email: ${String(me.primary_email ?? "")}`);

  const apiKeyBefore = await issueApiKey(project, claimPoll.access_token ?? "");
  console.log(`api key when disabled: ${JSON.stringify(apiKeyBefore.body)}`);

  await enableApiKeys(project);
  const apiKeyAfter = await issueApiKey(project, claimPoll.access_token ?? "");
  console.log(`api key when enabled: ${JSON.stringify(apiKeyAfter.body)}`);

  const revokeResponse = await requestJson<Record<string, unknown>>("/api/v1/projects/" + encodeURIComponent(project.projectId) + "/agent/revoke", {
    method: "POST",
    accessType: "client",
    project,
    body: {
      token: claimPoll.access_token,
      token_type_hint: "access_token",
    },
  });
  console.log(`revoke status: ${revokeResponse.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
