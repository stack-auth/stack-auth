import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, InternalApiKey, InternalProjectKeys, Project, Team, Webhook, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("is not allowed to list permissions from the other users on the client", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();

  const response = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Client can only list permissions for their own user. user_id must be either \\"me\\" or the ID of the current user",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("is not allowed to grant non-existing permission to a user on the server", async ({ expect }) => {
  const { userId } = await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();

  const response = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/does_not_exist`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "PERMISSION_NOT_FOUND",
        "details": { "permission_id": "does_not_exist" },
        "error": "Permission \\"does_not_exist\\" not found. Make sure you created it on the dashboard.",
      },
      "headers": Headers {
        "x-stack-known-error": "PERMISSION_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can create a new permission and grant it to a user on the server", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken({ config: { magic_link_enabled: true } });

  // create a permission child
  await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'child',
      description: 'Child permission',
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });

  // create a permission parent
  await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'parent',
      description: 'Parent permission',
      contained_permission_ids: ['child'],
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });

  await InternalApiKey.createAndSetProjectKeys(adminAccessToken);

  const { userId } = await Auth.Password.signUpWithEmail({ password: 'test1234' });
  const { teamId } = await Team.createAndAddCurrent();

  // list current permissions
  const response1 = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}&user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "id": "admin",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // grant new permission
  const response2 = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/parent`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "id": "parent",
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // list current permissions (should have the new permission)
  const response3 = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}&user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "id": "admin",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
          {
            "id": "parent",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can customize default team permissions", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response1 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'test'
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": [],
        "id": "test",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const { updateProjectResponse: response2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      team_member_default_permissions: [{ id: 'test' }],
    },
  });

  await InternalApiKey.createAndSetProjectKeys(adminAccessToken);

  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "config": {
          "allow_localhost": true,
          "allow_team_api_keys": false,
          "allow_user_api_keys": false,
          "client_team_creation_enabled": false,
          "client_user_deletion_enabled": false,
          "create_team_on_sign_up": false,
          "credential_enabled": true,
          "domains": [],
          "email_config": { "type": "shared" },
          "enabled_oauth_providers": [],
          "id": "<stripped UUID>",
          "magic_link_enabled": false,
          "oauth_account_merge_strategy": "link_method",
          "oauth_providers": [],
          "passkey_enabled": false,
          "sign_up_enabled": true,
          "team_creator_default_permissions": [{ "id": "admin" }],
          "team_member_default_permissions": [{ "id": "test" }],
          "user_default_permissions": [],
        },
        "created_at_millis": <stripped field 'created_at_millis'>,
        "description": "",
        "display_name": "New Project",
        "id": "<stripped UUID>",
        "is_production_mode": false,
        "user_count": 0,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should trigger team permission webhook when a permission is granted to a user", async ({ expect }) => {
  const { projectId, svixToken, endpointId } = await Webhook.createProjectWithEndpoint();

  const { userId } = await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();

  const grantPermissionResponse = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/$update_team`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(grantPermissionResponse.status).toBe(201);

  await wait(3000);

  const attemptResponse = await Webhook.listWebhookAttempts(projectId, endpointId, svixToken);
  const teamPermissionCreatedEvent = attemptResponse.find(event => event.eventType === "team_permission.created");

  expect(teamPermissionCreatedEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_permission.created",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "id": "$update_team",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_permission.created",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);
});

it("should trigger team permission webhook when a permission is revoked from a user", async ({ expect }) => {
  const { projectId, svixToken, endpointId } = await Webhook.createProjectWithEndpoint();

  const { userId } = await Auth.Otp.signIn();
  const { teamId } = await Team.createAndAddCurrent();

  // First grant the permission
  const grantPermissionResponse = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/$update_team`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(grantPermissionResponse.status).toBe(201);

  // Then revoke the permission
  const revokePermissionResponse = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId}/$update_team`, {
    accessType: "server",
    method: "DELETE",
  });

  expect(revokePermissionResponse.status).toBe(200);

  await wait(3000);

  const attemptResponse = await Webhook.listWebhookAttempts(projectId, endpointId, svixToken);
  const teamPermissionDeletedEvent = attemptResponse.find(event => event.eventType === "team_permission.deleted");

  expect(teamPermissionDeletedEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_permission.deleted",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "id": "$update_team",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_permission.deleted",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);
});
