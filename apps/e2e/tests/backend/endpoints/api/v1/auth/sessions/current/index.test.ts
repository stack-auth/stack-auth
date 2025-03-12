import { it } from "../../../../../../../helpers";
import { Auth, niceBackendFetch } from "../../../../../../backend-helpers";

it("should sign out users", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  await Auth.expectToBeSignedIn();
  const res = await Auth.signOut();
  expect(res.signOutResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  await Auth.expectToBeSignedOut();
  const refreshSessionResponse = await niceBackendFetch("/api/v1/auth/sessions/current/refresh", {
    method: "POST",
    accessType: "client",
  });
  expect(refreshSessionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        "error": "Refresh token not found for this project, or the session has expired/been revoked.",
      },
      "headers": Headers {
        "x-stack-known-error": "REFRESH_TOKEN_NOT_FOUND_OR_EXPIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should sign out user without refresh token, only using access token", async ({ expect }) => {
  await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch("/api/v1/auth/sessions/current", {
    method: "DELETE",
    accessType: "client",
    // missing refresh token
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it.todo("should not sign out users of a different project");

// TODO currently not supported, the endpoint just throws an error when only access token is given
it.todo("should sign out users even without refresh token");
