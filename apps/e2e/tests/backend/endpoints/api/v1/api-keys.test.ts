import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { it } from "../../../../helpers";
import { Auth, Project, ProjectApiKey, Team, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

it("can create, check, and list API keys", async ({ expect }: { expect: any }) => {
  await Project.createAndSwitch({ config: { magic_link_enabled: true } });
  const { userId } = await Auth.Otp.signIn();
  const { teamId } = await Team.create({ addCurrentUser: true });

  const { createUserApiKeyResponse } = await ProjectApiKey.User.create({
    user_id: userId,
    description: "Test API Key",
    expires_at_millis: null,
  });

  expect(createUserApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "user_id": "<stripped UUID>",
        "value": sk_<stripped user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const { createTeamApiKeyResponse } = await ProjectApiKey.Team.create({
    team_id: teamId,
    description: "Test Team API Key",
    expires_at_millis: null,
  });

  expect(createTeamApiKeyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "Test Team API Key",
        "id": "<stripped UUID>",
        "is_public": false,
        "team_id": "<stripped UUID>",
        "value": sk_<stripped team API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const checkUserApiKeyResponse = await ProjectApiKey.User.check(createUserApiKeyResponse.body.value);
  expect(checkUserApiKeyResponse).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test API Key",
      "id": "<stripped UUID>",
      "is_public": false,
      "user_id": "<stripped UUID>",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

  const checkTeamApiKeyResponse = await ProjectApiKey.Team.check(createTeamApiKeyResponse.body.value);
  expect(checkTeamApiKeyResponse).toMatchInlineSnapshot(`
    {
      "created_at_millis": <stripped field 'created_at_millis'>,
      "description": "Test Team API Key",
      "id": "<stripped UUID>",
      "is_public": false,
      "team_id": "<stripped UUID>",
      "value": { "last_four": <stripped field 'last_four'> },
    }
  `);

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
            "description": "Test API Key",
            "id": "<stripped UUID>",
            "is_public": false,
            "user_id": "<stripped UUID>",
            "value": { "last_four": <stripped field 'last_four'> },
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can create public API keys", async ({ expect }: { expect: any }) => {
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
        "user_id": "<stripped UUID>",
        "value": pk_<stripped public user API key>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it.todo("can create API keys with custom prefixes");

it.todo("can create API keys that expire");

it.todo("can read own API key on the client");

it.todo("returns 404 when checking a non-existent API key");

it.todo("returns 404 when checking a team API key with the user endpoint");

it.todo("requires user_id in read requests on the client");

it.todo("does not require user_id in read requests on the server");

it("prevents creating API keys for other users", async ({ expect }: { expect: any }) => {
  // First user signs in
  const { userId: userId1 } = await Auth.Otp.signIn();

  // Second user signs in
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();

  // First user tries to create an API key for the second user
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const unauthorizedResponse = await niceBackendFetch("/api/v1/user-api-keys", {
    method: "POST",
    body: {
      description: "Unauthorized User API Key",
      expires_at_millis: new Date().getTime() + 1000 * 60 * 60 * 24,
      user_id: userId2,
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

it("can manage API keys if only if the respective team permission is granted", async ({ expect }: { expect: any }) => {
  // First user creates a team and API key
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();


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

it.todo("can revoke API keys");

it.todo("prevents updating API keys for other users on the client");

it.todo("cannot pass user_id or team_id in update requests");

it.todo("can create API keys for other users on the server");

it.todo("cannot create API keys with invalid prefixes");

it.todo("can list all API keys for a user");

it.todo("prevents listing API keys for other users on the client");

it.todo("cannot list all API keys for all users on the server");

it.todo("can check own API keys on the client");

it.todo("can not check other users' API keys on the client");
