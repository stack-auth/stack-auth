import { encodeBase64Url } from "@stackframe/stack-shared/dist/utils/bytes";
import { encodeBasicAuthorizationHeader } from "@stackframe/stack-shared/dist/utils/http";
import { expect } from "vitest";
import { it, updateCookiesFromResponse } from "../../../../../../helpers";
import { Auth, InternalApiKey, Project, backendContext, niceBackendFetch } from "../../../../../backend-helpers";

async function authorizePart1(redirectUri: string = "http://localhost:30000/api/v2/auth/authorize") {
  let cookies = "";
  const first = await niceBackendFetch("/api/v1/integrations/custom/oauth/authorize", {
    method: "GET",
    query: {
      response_type: "code",
      client_id: "custom-local",
      redirect_uri: redirectUri,
      state: encodeBase64Url(new TextEncoder().encode(JSON.stringify({ details: { external_project_name: 'custom-project' } }))),
      code_challenge: "xf6HY7PIgoaCf_eMniSt-45brYE2J_05C9BnfIbueik",
      code_challenge_method: "S256",
    },
    redirect: "manual",
  });
  cookies = updateCookiesFromResponse(cookies, first);
  let second = undefined;
  let third = undefined;
  if (first.status === 307) {
    second = await first.follow({ redirect: "manual", headers: { "Cookie": cookies } });
    cookies = updateCookiesFromResponse(cookies, second);
    if (second.status === 303) {
      third = await second.follow({ redirect: "manual", headers: { "Cookie": cookies } });
      cookies = updateCookiesFromResponse(cookies, third);
    }
  }
  return { responses: [first, second, third], cookies };
}

async function authorizePart2(interactionUid: string, authorizationCode: string, cookies: string) {
  const first = await niceBackendFetch(`/api/v1/integrations/custom/oauth/idp/interaction/${encodeURIComponent(interactionUid)}/done`, {
    query: {
      code: authorizationCode,
    },
    headers: {
      "Cookie": cookies,
    },
    redirect: "manual",
  });
  cookies = updateCookiesFromResponse(cookies, first);
  let second = undefined;
  let third = undefined;
  if (first.status === 200) {
    second = await niceBackendFetch(`/api/v1/integrations/custom/oauth/idp/interaction/${encodeURIComponent(interactionUid)}/done`, {
      method: "POST",
      query: {
        code: authorizationCode,
      },
      headers: {
        "Cookie": cookies,
      },
      redirect: "manual",
    });
    cookies = updateCookiesFromResponse(cookies, second);
    if (second.status === 303) {
      third = await second.follow({
        headers: { "Cookie": cookies },
        redirect: "manual",
      });
      cookies = updateCookiesFromResponse(cookies, third);
    }
  }
  return { responses: [first, second, third], cookies };
}

async function authorize(projectId: string) {
  const authorizePart1Response = await authorizePart1();
  expect(authorizePart1Response.responses).toMatchInlineSnapshot(`
    [
      NiceResponse {
        "status": 307,
        "headers": Headers {
          "location": "http://localhost:8102/api/v1/integrations/custom/oauth/idp/auth?response_type=code&client_id=custom-local&redirect_uri=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&code_challenge=%3Cstripped+query+param%3E&code_challenge_method=S256&scope=openid",
          <some fields may have been hidden>,
        },
      },
      NiceResponse {
        "status": 303,
        "body": "Redirecting to <a href=\\"http://localhost:8102/api/v1/integrations/custom/oauth/idp/interaction/<stripped interaction UID>\\">http://localhost:8102/api/v1/integrations/custom/oauth/idp/interaction/<stripped interaction UID></a>.",
        "headers": Headers {
          "location": "http://localhost:8102/api/v1/integrations/custom/oauth/idp/interaction/<stripped interaction UID>",
          "set-cookie": <setting cookie "_interaction" at path "/api/v1/integrations/custom/oauth/idp/interaction/<stripped interaction UID>" to <stripped cookie value>>,
          "set-cookie": <setting cookie "_interaction.sig" at path "/api/v1/integrations/custom/oauth/idp/interaction/<stripped interaction UID>" to <stripped cookie value>>,
          "set-cookie": <setting cookie "_interaction_resume" at path "/api/v1/integrations/custom/oauth/idp/auth/<stripped auth UID>" to <stripped cookie value>>,
          "set-cookie": <setting cookie "_interaction_resume.sig" at path "/api/v1/integrations/custom/oauth/idp/auth/<stripped auth UID>" to <stripped cookie value>>,
          <some fields may have been hidden>,
        },
      },
      NiceResponse {
        "status": 307,
        "body": "http://localhost:8101/integrations/custom/confirm?interaction_uid=%3Cstripped+query+param%3E&amp=",
        "headers": Headers {
          "location": "http://localhost:8101/integrations/custom/confirm?interaction_uid=%3Cstripped+query+param%3E&external_project_name=custom-project",
          <some fields may have been hidden>,
        },
      },
    ]
  `);
  const dashboardConfirmUrl = new URL(authorizePart1Response.responses[2]!.headers.get("location")!);
  const interactionUid = dashboardConfirmUrl.searchParams.get("interaction_uid")!;
  const confirmResponse = await niceBackendFetch(`/api/v1/integrations/custom/internal/confirm`, {
    method: "POST",
    accessType: "server",
    body: {
      project_id: projectId,
      interaction_uid: interactionUid,
    },
  });
  expect(confirmResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "authorization_code": <stripped field 'authorization_code'> },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const innerAuthorizationCode = confirmResponse.body.authorization_code;
  const authorizePart2Response = await authorizePart2(interactionUid, innerAuthorizationCode, authorizePart1Response.cookies);
  expect(authorizePart2Response.responses).toMatchInlineSnapshot(`
    [
      NiceResponse {
        "status": 200,
        "body": "\\n            <html>\\n              <head>\\n                <title>Redirecting... — Stack Auth</title>\\n                <style id=\\"gradient-style\\">\\n                  body {\\n                    color: white;\\n                    background-image: linear-gradient(45deg, #000, #444, #000, #444, #000, #444, #000);\\n                    background-size: 400% 400%;\\n                    background-repeat: no-repeat;\\n                    animation: celebrate-gradient 60s linear infinite;\\n                    min-height: 100vh;\\n                  }\\n                  @keyframes celebrate-gradient {\\n                    0% { background-position: 0% 100%; }\\n                    100% { background-position: 100% 0%; }\\n                  }\\n                </style>\\n              </head>\\n              <body>\\n                <form id=\\"continue-form\\" method=\\"POST\\">\\n                  If you are not redirected, please press the button below.<br>\\n                  <input type=\\"submit\\" value=\\"Continue\\">\\n                </form>\\n                <script>\\n                  document.getElementById('continue-form').style.visibility = 'hidden';\\n                  document.getElementById('continue-form').submit();\\n                  setTimeout(() => {\\n                    document.getElementById('gradient-style').remove();\\n                    document.getElementById('continue-form').style.visibility = 'visible';\\n                  }, 12000);\\n                </script>\\n              </body>\\n            </html>\\n          ",
        "headers": Headers { <some fields may have been hidden> },
      },
      NiceResponse {
        "status": 303,
        "headers": Headers {
          "location": "http://localhost:8102/api/v1/integrations/custom/oauth/idp/auth/<stripped auth UID>",
          <some fields may have been hidden>,
        },
      },
      NiceResponse {
        "status": 303,
        "body": "http://localhost:30000/api/v2/auth/authorize?code=%3Cstripped+query+param%3E&amp=",
        "headers": Headers {
          "location": "http://localhost:30000/api/v2/auth/authorize?code=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&iss=http%3A%2F%2Flocalhost%3A8102%2Fapi%2Fv1%2Fintegrations%2Fcustom%2Foauth%2Fidp",
          "set-cookie": <setting cookie "_interaction_resume" at path "/api/v1/integrations/custom/oauth/idp/auth/<stripped auth UID>" to <stripped cookie value>>,
          "set-cookie": <setting cookie "_interaction_resume.sig" at path "/api/v1/integrations/custom/oauth/idp/auth/<stripped auth UID>" to <stripped cookie value>>,
          <some fields may have been hidden>,
        },
      },
    ]
  `);
  const authorizationCode = new URL(authorizePart2Response.responses[2]!.headers.get("location")!).searchParams.get("code")!;
  return { authorizationCode };
}

it(`should redirect to the correct callback URL`, async ({}) => {
  await Auth.Otp.signIn();
  const createdProject = await Project.create();

  await authorize(createdProject.projectId);
});

it(`should not redirect to the incorrect callback URL`, async ({}) => {
  await Auth.Otp.signIn();
  await Project.create();

  const result = await authorizePart1("http://localhost:30000/api/v2/wrong-url/authorize");
  expect(result).toMatchInlineSnapshot(`
    {
      "cookies": "",
      "responses": [
        NiceResponse {
          "status": 307,
          "headers": Headers {
            "location": "http://localhost:8102/api/v1/integrations/custom/oauth/idp/auth?response_type=code&client_id=custom-local&redirect_uri=%3Cstripped+query+param%3E&state=%3Cstripped+query+param%3E&code_challenge=%3Cstripped+query+param%3E&code_challenge_method=S256&scope=openid",
            <some fields may have been hidden>,
          },
        },
        NiceResponse {
          "status": 400,
          "body": {
            "error": "invalid_redirect_uri",
            "error_description": "redirect_uri did not match any of the client's registered redirect_uris",
            "iss": "http://localhost:8102/api/v1/integrations/custom/oauth/idp",
            "state": "eyJkZXRhaWxzIjp7ImV4dGVybmFsX3Byb2plY3RfbmFtZSI6ImN1c3RvbS1wcm9qZWN0In19",
          },
          "headers": Headers { <some fields may have been hidden> },
        },
        undefined,
      ],
    }
  `);
});

it(`should exchange the authorization code for an admin API key that works`, async ({}) => {
  await Auth.Otp.signIn();
  const createdProject = await Project.create();

  const { authorizationCode } = await authorize(createdProject.projectId);
  const tokenResponse = await niceBackendFetch(`/api/v1/integrations/custom/oauth/token`, {
    method: "POST",
    body: {
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: "W2LPAD4M4ES-3wBjzU6J5ApykmuxQy5VTs3oSmtboDM",
      redirect_uri: "http://localhost:30000/api/v2/auth/authorize",
    },
    headers: {
      "Authorization": encodeBasicAuthorizationHeader("custom-local", "custom-local-secret")
    },
  });
  expect(tokenResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "project_id": "<stripped UUID>",
        "token_type": "api_key",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(tokenResponse.body.project_id).toBe(createdProject.projectId);
  const apiKey = tokenResponse.body.access_token;
  backendContext.set({
    projectKeys: {
      projectId: createdProject.projectId,
      superSecretAdminKey: apiKey,
    },
    userAuth: null,
  });
  const listApiKeysResponse = await InternalApiKey.list();
  expect(listApiKeysResponse).toMatchInlineSnapshot(`
    {
      "is_paginated": false,
      "items": [
        {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "description": "Auto-generated for an external project (DO NOT DELETE)",
          "expires_at_millis": <stripped field 'expires_at_millis'>,
          "id": "<stripped UUID>",
          "super_secret_admin_key": { "last_four": <stripped field 'last_four'> },
        },
      ],
    }
  `);
});

it(`should not exchange the authorization code when the client secret is incorrect`, async ({}) => {
  await Auth.Otp.signIn();
  const createdProject = await Project.create();

  const { authorizationCode } = await authorize(createdProject.projectId);
  const tokenResponse = await niceBackendFetch(`/api/v1/integrations/custom/oauth/token`, {
    method: "POST",
    body: {
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: "W2LPAD4M4ES-3wBjzU6J5ApykmuxQy5VTs3oSmtboDM",
      redirect_uri: "http://localhost:30000/api/v2/auth/authorize",
    },
    headers: {
      "Authorization": encodeBasicAuthorizationHeader("custom-local", "wrong-secret")
    },
  });
  expect(tokenResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on POST /api/v1/integrations/custom/oauth/token:
              - Invalid client_id:client_secret values; did you use the correct values for the integration?
          \`,
        },
        "error": deindent\`
          Request validation failed on POST /api/v1/integrations/custom/oauth/token:
            - Invalid client_id:client_secret values; did you use the correct values for the integration?
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});
