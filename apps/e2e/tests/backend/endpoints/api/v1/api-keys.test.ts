import { it } from "../../../../helpers";
import { Auth, Team, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

it("can create and list API keys", async ({ expect }: { expect: any }) => {
  // First sign in to get authentication
  const { userId } = await Auth.Otp.signIn();

  // Create a new API key
  const createResponse = await niceBackendFetch("/api/v1/api-keys", {
    method: "POST",
    body: {
      description: "Test API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24, // 24 hours from now
      project_user_id: userId,
    },
    accessType: "client",
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "secret_api_key": <stripped field 'secret_api_key'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // List API keys
  const listResponse = await niceBackendFetch("/api/v1/api-keys?project_user_id=" + userId, {
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "created_at_millis": <stripped field 'created_at_millis'>,
            "description": "Test API Key",
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "secret_api_key": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("handles team API key creation and access control", async ({ expect }: { expect: any }) => {
  // First user creates a team and API key
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();


  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId1}/$manage_api_keys`, {
    accessType: "server",
    method: "POST",
    body: {},
  });


  // Create API key for the team
  const createResponse = await niceBackendFetch("/api/v1/api-keys", {
    method: "POST",
    body: {
      description: "Team API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24, // 24 hours from now
      team_id: teamId,
    },
    accessType: "client",
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Team API Key",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "secret_api_key": <stripped field 'secret_api_key'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // List team API keys
  const listResponse = await niceBackendFetch("/api/v1/api-keys?team_id=" + teamId, {
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "created_at_millis": <stripped field 'created_at_millis'>,
            "description": "Team API Key",
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "secret_api_key": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Second user tries to create API key for the same team
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const unauthorizedResponse = await niceBackendFetch("/api/v1/api-keys", {
    method: "POST",
    body: {
      description: "Unauthorized Team API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24,
      team_id: teamId,
    },
    accessType: "client",
  });

  expect(unauthorizedResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "TEAM_PERMISSION_REQUIRED",
        "details": {
          "permission_id": "$manage_api_keys",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "error": "User <stripped UUID> does not have permission $manage_api_keys in team <stripped UUID>.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("prevents creating API keys for other users", async ({ expect }: { expect: any }) => {
  // First user signs in
  const { userId: userId1 } = await Auth.Otp.signIn();

  // Second user signs in
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();

  // First user tries to create an API key for the second user
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const unauthorizedResponse = await niceBackendFetch("/api/v1/api-keys", {
    method: "POST",
    body: {
      description: "Unauthorized User API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24,
      project_user_id: userId2,
    },
    accessType: "client",
  });

  expect(unauthorizedResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only manage their own api keys",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
