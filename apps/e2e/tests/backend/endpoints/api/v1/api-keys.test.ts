import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { it } from "../../../../helpers";
import { Auth, Project, ProjectApiKey, Team, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

async function createAndSwitchToAPIEnabledProject(allow_team_api_keys = true, allow_user_api_keys = true) {
  await Project.createAndSwitch({ config: { magic_link_enabled: true, allow_team_api_keys, allow_user_api_keys } });
}

it("throws an error when user API keys are disabled and trying to use user API keys", async ({ expect }: { expect: any }) => {
  // Create a project with user API keys disabled
  await createAndSwitchToAPIEnabledProject(true, false);
  await Auth.Otp.signIn();

  // Try to create a user API key
  const createResponse = await niceBackendFetch("/api/v1/user-api-keys", {
    method: "POST",
    accessType: "client",
    body: {
      user_id: "me",
      description: "This should fail",
      expires_at_millis: null,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "User API keys are not enabled for this project.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to list user API keys
  const listResponse = await niceBackendFetch("/api/v1/user-api-keys?user_id=me", {
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "User API keys are not enabled for this project.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);


  const { teamId } = await Team.create({ addCurrentUser: true });
  // Try to create a team API key (should work)
  const createTeamResponse = await niceBackendFetch("/api/v1/team-api-keys", {
    method: "POST",
    accessType: "client",
    body: {
      team_id: teamId,
      description: "This should work",
      expires_at_millis: null,
    },
  });

  expect(createTeamResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "This should work",
        "id": "<stripped UUID>",
        "is_public": false,
        "team_id": "<stripped UUID>",
        "type": "team",
        "value": sk_<stripped team API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can create public API keys", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  await Auth.Otp.signIn();

  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: "me",
    description: "Test API Key",
    expires_at_millis: null,
    is_public: true,
  });

  expect(createUserApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": true,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": pk_<stripped public user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can create API keys that expire", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create a user API key that expires in 1 hour
  const oneHourFromNow = new Date().getTime() + 1000 * 60 * 60;
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test Expiring User API Key",
    expires_at_millis: oneHourFromNow,
  });

  expect(createUserApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test Expiring User API Key",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": sk_<stripped user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Create an expired API key
  const oneHourAgo = new Date().getTime() - 1000 * 60 * 60;
  const { createUserApiKeyResponse: createExpiredApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test Expired User API Key",
    expires_at_millis: oneHourAgo,
  });

  expect(createExpiredApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test Expired User API Key",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": sk_<stripped user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the valid API keys work by checking them
  const checkUserApiKeyResponse = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
  expect(checkUserApiKeyResponse).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test Expiring User API Key",
      "expires_at_millis": <stripped field 'expires_at_millis'>,
      "id": "<stripped UUID>",
      "is_public": false,
      "type": "user",
      "user_id": "<stripped UUID>",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

  // Try to check the expired API key
  const checkExpiredApiKeyResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createExpiredApiKeyResponse.body.value,
    },
  });

  expect(checkExpiredApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "API_KEY_EXPIRED",
        "error": "API key has expired.",
      },
      "headers": Headers {
        "x-stack-known-error": "API_KEY_EXPIRED",
        <some fields may have been hidden>,
      },
    }
  `);

  // List API keys to verify expiration times are included
  const listUserApiKeysResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys?user_id=${userId}`, {
    accessType: "client",
  });
  expect(listUserApiKeysResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "created_at_millis": <stripped field 'created_at_millis'>,
            "description": "Test Expired User API Key",
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "is_public": false,
            "type": "user",
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
          {
            "created_at_millis": <stripped field 'created_at_millis'>,
            "description": "Test Expiring User API Key",
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "is_public": false,
            "type": "user",
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can read own API key on the client", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key",
    expires_at_millis: null,
  });

  // Read the API key using the client endpoint
  const readResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    accessType: "client",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("returns 404 when checking a non-existent API key", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  await Auth.Otp.signIn();

  // Try to check a non-existent API key
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: "sk_this_is_a_fake_api_key_123456789",
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "API_KEY_NOT_FOUND",
        "error": "API key not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "API_KEY_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("returns 400 when checking a team API key with the user endpoint", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();
  const { teamId } = await Team.create({ addCurrentUser: true });

  // Create a team API key
  const { createTeamApiKeyResponse } = await ProjectApiKey.Team.create({
    team_id: teamId,
    description: "Test Team API Key",
    expires_at_millis: null,
  });

  // Try to check the team API key using the user endpoint
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createTeamApiKeyResponse.body.value,
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "WRONG_API_KEY_TYPE",
        "details": {
          "actual_type": "team",
          "expected_type": "user",
        },
        "error": "This endpoint is for user API keys, but a team API key was provided.",
      },
      "headers": Headers {
        "x-stack-known-error": "WRONG_API_KEY_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not require user_id in read requests on the client", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key",
    expires_at_millis: null,
  });

  // Try to read the API key without user_id
  const readResponseWithoutUserId = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}`, {
    accessType: "client",
  });

  expect(readResponseWithoutUserId).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to read the API key with both user_id and team_id
  const readResponseWithBothIds = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}&team_id=some-team-id`, {
    accessType: "client",
  });

  expect(readResponseWithBothIds).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on GET /api/v1/user-api-keys/<stripped UUID>:
              - query contains unknown properties: team_id
          \`,
        },
        "error": deindent\`
          Request validation failed on GET /api/v1/user-api-keys/<stripped UUID>:
            - query contains unknown properties: team_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not require user_id in read requests on the server", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key",
    expires_at_millis: null,
  });

  // Read the API key using the server endpoint without user_id
  const readResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}`, {
    accessType: "server",
  });

  expect(readResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("prevents creating API keys for other users", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  // First user signs in
  const { userId: userId1 } = await Auth.Otp.signIn();

  // Second user signs in
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const unauthorizedResponse = await niceBackendFetch("/api/v1/user-api-keys", {
    method: "POST",
    body: {
      description: "Unauthorized User API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24,
      user_id: userId1,
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

it("can manage API keys if and only if the respective team permission is granted", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();


  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId1}/$manage_api_keys`, {
    accessType: "server",
    method: "POST",
    body: {},
  });


  // Create API key for the team
  const createResponse = await niceBackendFetch("/api/v1/team-api-keys", {
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
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Team API Key",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "is_public": false,
        "team_id": "<stripped UUID>",
        "type": "team",
        "value": sk_<stripped team API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // List team API keys
  const listResponse = await niceBackendFetch("/api/v1/team-api-keys?team_id=" + teamId, {
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
            "is_public": false,
            "team_id": "<stripped UUID>",
            "type": "team",
            "value": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Second user tries to create API key for the same team
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const unauthorizedResponse = await niceBackendFetch("/api/v1/team-api-keys", {
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
      "status": 404,
      "body": {
        "code": "API_KEY_NOT_FOUND",
        "error": "API key not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "API_KEY_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can revoke API keys", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key to Revoke",
    expires_at_millis: null,
  });

  // Verify the API key works initially
  const checkResponseBeforeRevoke = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
  expect(checkResponseBeforeRevoke).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test API Key to Revoke",
      "id": "<stripped UUID>",
      "is_public": false,
      "type": "user",
      "user_id": "<stripped UUID>",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

  const revokeResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      revoked: true,
    },
  });

  expect(revokeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key to Revoke",
        "id": "<stripped UUID>",
        "is_public": false,
        "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Try to check the revoked API key
  const checkResponseAfterRevoke = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createUserApiKeyResponse.body.value,
    },
  });

  expect(checkResponseAfterRevoke).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "API_KEY_REVOKED",
        "error": "API key has been revoked.",
      },
      "headers": Headers {
        "x-stack-known-error": "API_KEY_REVOKED",
        <some fields may have been hidden>,
      },
    }
  `);

  // Verify the API key is still in the list but marked as revoked
  const listResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys?user_id=${userId}`, {
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
            "description": "Test API Key to Revoke",
            "id": "<stripped UUID>",
            "is_public": false,
            "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
            "type": "user",
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("prevents updating API keys for other users on the client", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  // First user signs in and creates an API key
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { createUserApiKeyResponse: firstUserApiKey } = await ProjectApiKey.User.create({
    user_id: userId1,
    description: "First User's API Key",
    expires_at_millis: null,
  });

  // Second user signs in and creates an API key
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();
  // Second user tries to update first user's API key

  const unauthorizedResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${firstUserApiKey.body.id}?user_id=${userId1}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      description: "Unauthorized Update",
      revoked: true,
    },
  });

  expect(unauthorizedResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only manage their own api keys",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the second user's API key wasn't actually updated
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: firstUserApiKey.body.value,
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "First User's API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("cannot pass user_id or team_id in update requests", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key",
    expires_at_millis: null,
  });

  // Try to update the API key with user_id in the request body
  const updateWithUserIdResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      description: "Updated Description",
      user_id: "some-other-user-id", // Attempting to change ownership
    },
  });

  expect(updateWithUserIdResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/user-api-keys/<stripped UUID>:
              - body contains unknown properties: user_id
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/user-api-keys/<stripped UUID>:
            - body contains unknown properties: user_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);

  // Try to update the API key with team_id in the request body
  const updateWithTeamIdResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      description: "Updated Description",
      team_id: "some-team-id", // Attempting to convert to team key
    },
  });

  expect(updateWithTeamIdResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": {
          "message": deindent\`
            Request validation failed on PATCH /api/v1/user-api-keys/<stripped UUID>:
              - body contains unknown properties: team_id
          \`,
        },
        "error": deindent\`
          Request validation failed on PATCH /api/v1/user-api-keys/<stripped UUID>:
            - body contains unknown properties: team_id
        \`,
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);

  // Verify the API key wasn't modified
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createUserApiKeyResponse.body.value,
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can create API keys for other users on the server", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  // First user signs in
  const { userId: userId1 } = await Auth.Otp.signIn();

  const user1Creds = backendContext.value.userAuth;


  // Second user signs in
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();


  // Create an API key for the second user using server access
  const createResponse = await niceBackendFetch("/api/v1/user-api-keys", {
    method: "POST",
    accessType: "server",
    body: {
      description: "Server-created API Key for First User",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24, // 24 hours from now
      user_id: userId1,
    },
  });

  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Server-created API Key for First User",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": sk_<stripped user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({
    userAuth: user1Creds,
  });

  // Verify the API key works on the server by checking it
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createResponse.body.value,
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Server-created API Key for First User",
        "expires_at_millis": <stripped field 'expires_at_millis'>,
        "id": "<stripped UUID>",
        "is_public": false,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the first user can not see the API key
  const listResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys?user_id=${userId2}`, {
    accessType: "client",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only manage their own api keys",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can list all API keys for a user", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create multiple API keys for the user
  const { createUserApiKeyResponse: apiKey1 } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "First API Key",
    expires_at_millis: null,
  });

  const { createUserApiKeyResponse: apiKey2 } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Second API Key",
    expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24, // 24 hours from now
  });

  // List all API keys for the user
  const listResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys?user_id=${userId}`, {
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
            "description": "Second API Key",
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "is_public": false,
            "type": "user",
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
          {
            "created_at_millis": <stripped field 'created_at_millis'>,
            "description": "First API Key",
            "id": "<stripped UUID>",
            "is_public": false,
            "type": "user",
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("prevents listing API keys for other users on the client", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  // First user signs in and creates an API key
  const { userId: userId1 } = await Auth.Otp.signIn();
  await ProjectApiKey.User.create({
    user_id: userId1,
    description: "First User's API Key",
    expires_at_millis: null,
  });

  // Second user signs in and creates an API key
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();
  await ProjectApiKey.User.create({
    user_id: userId2,
    description: "Second User's API Key",
    expires_at_millis: null,
  });

  // Second user tries to list first user's API keys
  const unauthorizedResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys?user_id=${userId1}`, {
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


// Should the server be allowed to do this maybe?
it("cannot list all API keys for all users on the server", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();

  // First user signs in and creates an API key
  const { userId: userId1 } = await Auth.Otp.signIn();
  await ProjectApiKey.User.create({
    user_id: userId1,
    description: "First User's API Key",
    expires_at_millis: null,
  });

  // Second user signs in and creates an API key
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();
  await ProjectApiKey.User.create({
    user_id: userId2,
    description: "Second User's API Key",
    expires_at_millis: null,
  });

  // Try to list all API keys without specifying a user_id
  const listResponse = await niceBackendFetch("/api/v1/user-api-keys", {
    accessType: "server",
  });

  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "SCHEMA_ERROR",
        "details": { "message": "user_id is required for user API keys" },
        "error": "user_id is required for user API keys",
      },
      "headers": Headers {
        "x-stack-known-error": "SCHEMA_ERROR",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("revoking an API key twice will not change the revocation timestamp", async ({ expect }: { expect: any }) => {
  await createAndSwitchToAPIEnabledProject();
  const { userId } = await Auth.Otp.signIn();

  // Create an API key
  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key to Revoke",
    expires_at_millis: null,
  });

  // First revocation
  const firstRevokeResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      revoked: true,
    },
  });

  expect(firstRevokeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key to Revoke",
        "id": "<stripped UUID>",
        "is_public": false,
        "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const firstRevokeTimestamp = firstRevokeResponse.body.manually_revoked_at_millis;

  // Second revocation attempt
  const secondRevokeResponse = await niceBackendFetch(urlString`/api/v1/user-api-keys/${createUserApiKeyResponse.body.id}?user_id=${userId}`, {
    method: "PATCH",
    accessType: "client",
    body: {
      revoked: true,
    },
  });

  expect(secondRevokeResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key to Revoke",
        "id": "<stripped UUID>",
        "is_public": false,
        "manually_revoked_at_millis": <stripped field 'manually_revoked_at_millis'>,
        "type": "user",
        "user_id": "<stripped UUID>",
        "value": { "last_four": <stripped field 'last_four'> },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const secondRevokeTimestamp = secondRevokeResponse.body.manually_revoked_at_millis;

  // Verify the timestamps are the same
  expect(firstRevokeTimestamp).toBe(secondRevokeTimestamp);

  // Verify the API key is still revoked
  const checkResponse = await niceBackendFetch("/api/v1/user-api-keys/check", {
    method: "POST",
    accessType: "server",
    body: {
      api_key: createUserApiKeyResponse.body.value,
    },
  });

  expect(checkResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "API_KEY_REVOKED",
        "error": "API key has been revoked.",
      },
      "headers": Headers {
        "x-stack-known-error": "API_KEY_REVOKED",
        <some fields may have been hidden>,
      },
    }
  `);
});


// We don't currently support these features

it.todo("can check own API keys on the client");

it.todo("can not check other users' API keys on the client");

it.todo("cannot create API keys with invalid prefixes");
