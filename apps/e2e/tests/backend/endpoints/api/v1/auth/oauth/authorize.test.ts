import { it } from "../../../../../../helpers";
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
