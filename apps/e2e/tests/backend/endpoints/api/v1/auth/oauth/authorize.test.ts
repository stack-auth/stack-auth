import { it, localRedirectUrl } from "../../../../../../helpers";
import { localhostUrl } from "../../../../../../helpers/ports";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

const enableSharedSpotifyProvider = async () => {
  await Project.updateConfig({
    "auth.oauth.providers.spotify": {
      type: "spotify",
      isShared: true,
      allowSignIn: true,
      allowConnectedAccounts: true,
    },
  });
};

const setupOAuthProject = async (requirePublishableClientKey?: boolean) => {
  const { projectId } = await Project.createAndSwitch();
  if (requirePublishableClientKey !== undefined) {
    await Project.updateProjectConfig({
      "project.requirePublishableClientKey": requirePublishableClientKey,
    });
  }
  await enableSharedSpotifyProvider();
  backendContext.set({
    projectKeys: { projectId },
    userAuth: null,
  });
  return projectId;
};

it("should redirect the user to the OAuth provider with the right arguments", async ({ expect }) => {
  const response = await Auth.OAuth.authorize();
  expect(response.authorizeResponse.status).toBe(307);
  const firstLocation = response.authorizeResponse.headers.get("location");
  expect(firstLocation).toBeTruthy();
  const firstLocationUrl = new URL(firstLocation!);
  expect(firstLocationUrl.origin).toBe(localhostUrl("14"));
  expect(firstLocationUrl.pathname).toBe("/auth");
  expect(response.authorizeResponse.headers.get("set-cookie")).toMatch(/^stack-oauth-inner-[^;]+=[^;]+; Path=\/; Expires=[^;]+; Max-Age=\d+;( Secure;)? HttpOnly$/);
});

it("should redirect the user to the OAuth provider with the right arguments even when forcing a branch id", async ({ expect }) => {
  const response = await Auth.OAuth.authorize({ forceBranchId: "main" });
  expect(response.authorizeResponse.status).toBe(307);
  const secondLocation = response.authorizeResponse.headers.get("location");
  expect(secondLocation).toBeTruthy();
  expect(secondLocation).toMatchInlineSnapshot(`"http://localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>14/auth?client_id=spotify&scope=openid+offline_access&response_type=code&redirect_uri=%3Cstripped+query+param%3E&code_challenge_method=S256&code_challenge=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&access_type=offline&prompt=consent"`);
  expect(response.authorizeResponse.headers.get("set-cookie")).toMatch(/^stack-oauth-inner-[^;]+=[^;]+; Path=\/; Expires=[^;]+; Max-Age=\d+;( Secure;)? HttpOnly$/);
});

it("should return the OAuth location as JSON when requested by the SDK flow", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      stack_response_mode: "json",
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "location": "http://localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>14/auth?client_id=spotify&scope=openid+offline_access&response_type=code&redirect_uri=%3Cstripped+query+param%3E&code_challenge_method=S256&code_challenge=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&access_type=offline&prompt=consent" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  // In JSON mode, PKCE prevents CSRF so no cookie is needed
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("should not redirect the user to the OAuth provider with the right arguments when forcing a branch id that does not exist", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery({ forceBranchId: "does-not-exist" }),
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
        "details": { "client_id": "internal#does-not-exist" },
        "error": "The OAuth client ID or secret is invalid. The client ID must be equal to the project ID (potentially with a hash and a branch ID), and the client secret must be a publishable client key.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should be able to fetch the inner callback URL by following the OAuth provider redirects", async ({ expect }) => {
  const { innerCallbackUrl } = await Auth.OAuth.getInnerCallbackUrl();
  expect(innerCallbackUrl.origin).toMatchInlineSnapshot(`"http://localhost:<$NEXT_PUBLIC_STACK_PORT_PREFIX>02"`);
  expect(innerCallbackUrl.pathname).toBe("/api/v1/auth/oauth/callback/spotify");
});

it("should fail if an invalid client_id is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      client_id: "some-invalid-client-id",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
        "details": { "client_id": "some-invalid-client-id" },
        "error": "The OAuth client ID or secret is invalid. The client ID must be equal to the project ID (potentially with a hash and a branch ID), and the client secret must be a publishable client key.",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_OAUTH_CLIENT_ID_OR_SECRET",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail if an invalid client_secret is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      client_secret: "some-invalid-client-secret",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INVALID_PUBLISHABLE_CLIENT_KEY",
        "details": { "project_id": "internal" },
        "error": "The publishable key is not valid for the project \\"internal\\". Does the project and/or the key exist?",
      },
      "headers": Headers {
        "x-stack-known-error": "INVALID_PUBLISHABLE_CLIENT_KEY",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow public client secret sentinel when publishable keys are not required", async ({ expect }) => {
  await setupOAuthProject(false);

  const response = await Auth.OAuth.authorize({ includeClientSecret: false });
  expect(response.authorizeResponse.status).toBe(307);
});

it("should allow public client secret sentinel when publishable keys are not configured", async ({ expect }) => {
  await setupOAuthProject();

  const response = await Auth.OAuth.authorize({ includeClientSecret: false });
  expect(response.authorizeResponse.status).toBe(307);
});

it("should reject public client secret sentinel when publishable keys are required", async ({ expect }) => {
  await setupOAuthProject(true);

  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery({ includeClientSecret: false }),
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "PUBLISHABLE_CLIENT_KEY_REQUIRED_FOR_PROJECT",
        "details": { "project_id": "<stripped UUID>" },
        "error": "Publishable client keys are required for this project. Create one in Project Keys, or disable this requirement there to allow keyless client access.",
      },
      "headers": Headers {
        "x-stack-known-error": "PUBLISHABLE_CLIENT_KEY_REQUIRED_FOR_PROJECT",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail if an invalid redirect URL is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      redirect_uri: "this is an invalid URL string",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on GET /api/v1/auth/oauth/authorize/spotify:
              - query.redirect_uri contains spaces
              - query.redirect_uri is not a valid URL
          \`,
        },
        "error": deindent\`
          Request validation failed on GET /api/v1/auth/oauth/authorize/spotify:
            - query.redirect_uri contains spaces
            - query.redirect_uri is not a valid URL
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail if an invalid after_callback_redirect_url is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      after_callback_redirect_url: "not-a-valid-url",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on GET /api/v1/auth/oauth/authorize/spotify:
              - query.after_callback_redirect_url is not a valid URL
          \`,
        },
        "error": deindent\`
          Request validation failed on GET /api/v1/auth/oauth/authorize/spotify:
            - query.after_callback_redirect_url is not a valid URL
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should fail if an untrusted after_callback_redirect_url is provided", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      after_callback_redirect_url: "https://evil.example.com/post-auth",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

// Regression: provider_scope against a shared provider must be rejected on
// every authorize path — not only when a link token is present. A malicious
// client would otherwise request elevated scopes under Stack Auth's shared
// OAuth app on a plain sign-in.
it("should reject provider_scope on shared provider for plain sign-in (no link token)", async ({ expect }) => {
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      provider_scope: "user-read-private user-library-modify playlist-modify-public",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
        "error": "Extra scopes are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use extra scopes.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should reject provider_scope on shared provider for account-link flow", async ({ expect }) => {
  await Auth.OAuth.signIn();
  const response = await niceBackendFetch("/api/v1/auth/oauth/authorize/spotify", {
    redirect: "manual",
    query: {
      ...await Auth.OAuth.getAuthorizeQuery(),
      type: "link",
      provider_scope: "user-read-private user-library-modify",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
        "error": "Extra scopes are not available with shared OAuth keys. Please add your own OAuth keys on the Stack dashboard to use extra scopes.",
      },
      "headers": Headers {
        "x-stack-known-error": "OAUTH_EXTRA_SCOPE_NOT_AVAILABLE_WITH_SHARED_OAUTH_KEYS",
        <some fields may have been hidden>,
      },
    }
  `);
});
