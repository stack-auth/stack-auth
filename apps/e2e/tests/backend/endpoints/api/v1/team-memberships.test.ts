import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { STACK_SVIX_SERVER_URL, it, niceFetch } from "../../../../helpers";
import { Auth, InternalApiKey, InternalProjectKeys, Project, Team, Webhook, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";


it("is not allowed to add user to team on client", async ({ expect }) => {
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  const response = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "client",
    method: "POST",
    body: {},
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "client",
          "allowed_access_types": [
            "server",
            "admin",
          ],
        },
        "error": "The x-stack-access-type header must be 'server' or 'admin', but was 'client'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("creates a team and allows managing users on the server", async ({ expect }) => {
  const { userId: userId1 } = await Auth.Otp.signIn();
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  const response = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response2 = await niceBackendFetch(`/api/v1/users?team_id=${teamId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // remove user from team
  const response3 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId2}`, {
    accessType: "server",
    method: "DELETE",
    body: {},
  });
  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response4 = await niceBackendFetch(`/api/v1/users?team_id=${teamId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("lets users be on multiple teams", async ({ expect }) => {
  const { userId: creatorUserId } = await Auth.Otp.signIn();
  const { teamId: teamId1 } = await Team.createWithCurrentAsCreator();
  const { teamId: teamId2 } = await Team.createWithCurrentAsCreator();

  await bumpEmailAddress();
  const { userId } = await Auth.Otp.signIn();
  await niceBackendFetch(`/api/v1/team-memberships/${teamId1}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await niceBackendFetch(`/api/v1/team-memberships/${teamId2}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  const response = await niceBackendFetch(`/api/v1/users?team_id=${teamId1}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response2 = await niceBackendFetch(`/api/v1/users?team_id=${teamId2}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
          {
            "auth_with_email": true,
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": null,
            "has_password": false,
            "id": "<stripped UUID>",
            "is_anonymous": false,
            "last_active_at_millis": <stripped field 'last_active_at_millis'>,
            "oauth_providers": [],
            "otp_auth_enabled": true,
            "passkey_auth_enabled": false,
            "primary_email": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "primary_email_auth_enabled": true,
            "primary_email_verified": true,
            "profile_image_url": null,
            "requires_totp_mfa": false,
            "selected_team": null,
            "selected_team_id": null,
            "server_metadata": null,
            "signed_up_at_millis": <stripped field 'signed_up_at_millis'>,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow adding a user to a team if the user is already a member of the team", async ({ expect }) => {
  const { userId: userId1 } = await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  const response1 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 409,
      "body": {
        "code": "TEAM_MEMBERSHIP_ALREADY_EXISTS",
        "error": "Team membership already exists.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_MEMBERSHIP_ALREADY_EXISTS",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("does not allow adding a user that doesn't exist to a team", async ({ expect }) => {
  const { teamId } = await Team.create();

  const response1 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/12345678-1234-4234-9234-123456789012`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "USER_NOT_FOUND",
        "error": "User not found.",
      },
      "headers": Headers {
        "x-stack-known-error": "USER_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("should give team creator default permissions", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken({ config: { magic_link_enabled: true } });
  await InternalApiKey.createAndSetProjectKeys(adminAccessToken);

  const { userId: userId1 } = await Auth.Password.signUpWithEmail({ password: 'test1234' });
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Password.signUpWithEmail({ password: 'test1234' });
  const { teamId } = await Team.createWithCurrentAsCreator();

  await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  const response = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}&user_id=${userId2}`, {
    accessType: "server",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "id": "team_admin",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("allows leaving team", async ({ expect }) => {
  await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  // Does not have permission to remove user from team
  const response1 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/me`, {
    accessType: "client",
    method: "DELETE",
    body: {},
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("removes user from team on the client", async ({ expect }) => {
  const { userId: userId1 } = await Auth.Otp.signIn();
  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();
  const { teamId } = await Team.create();
  await Team.addMember(teamId, userId1);
  await Team.addMember(teamId, userId2);

  // Does not have permission to remove user from team
  const response1 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "client",
    method: "DELETE",
    body: {},
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "TEAM_PERMISSION_REQUIRED",
        "details": {
          "permission_id": "$remove_members",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "error": "User <stripped UUID> does not have permission $remove_members in team <stripped UUID>.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId2}/$remove_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Has permission to remove user from team
  const response2 = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "client",
    method: "DELETE",
    body: {},
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates a team on the server and adds a different user as the creator", async ({ expect }) => {
  const user1Mailbox = await bumpEmailAddress();
  const { userId: userId1 } = await Auth.Otp.signIn();
  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/teams", {
    accessType: "server",
    method: "POST",
    body: {
      display_name: "My Team",
      creator_user_id: userId1,
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "client_metadata": null,
        "client_read_only_metadata": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_name": "My Team",
        "id": "<stripped UUID>",
        "profile_image_url": null,
        "server_metadata": null,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({ mailbox: user1Mailbox });
  await Auth.Otp.signIn();

  const response2 = await niceBackendFetch(`/api/v1/teams?user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "client_metadata": null,
            "client_read_only_metadata": null,
            "display_name": "My Team",
            "id": "<stripped UUID>",
            "profile_image_url": null,
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("should trigger team membership webhook when a user is added to a team", async ({ expect }) => {
  const { projectId, svixToken, endpointId } = await Webhook.createProjectWithEndpoint();

  await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  await bumpEmailAddress();
  const { userId } = await Auth.Otp.signIn();

  const addUserResponse = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(addUserResponse.status).toBe(201);

  const teamMembershipCreatedEvent = await Webhook.findWebhookAttempt(projectId, endpointId, svixToken, event => event.eventType === "team_membership.created");

  expect(teamMembershipCreatedEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_membership.created",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_membership.created",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);

});


it("should trigger team membership webhook when a user is removed from a team", async ({ expect }) => {
  const { projectId, svixToken, endpointId } = await Webhook.createProjectWithEndpoint();

  await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  await bumpEmailAddress();
  const { userId } = await Auth.Otp.signIn();

  const addUserResponse = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(addUserResponse.status).toBe(201);

  const removeUserResponse = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
    accessType: "server",
    method: "DELETE"
  });

  expect(removeUserResponse.status).toBe(200);

  const teamMembershipDeletedEvent = await Webhook.findWebhookAttempt(projectId, endpointId, svixToken, event => event.eventType === "team_membership.deleted");

  expect(teamMembershipDeletedEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_membership.deleted",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_membership.deleted",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);
});

it("should trigger team permission webhook when a user is added to a team", async ({ expect }) => {
  const { projectId, svixToken, endpointId } = await Webhook.createProjectWithEndpoint();

  await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  await bumpEmailAddress();
  const { userId } = await Auth.Otp.signIn();

  const addUserResponse = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(addUserResponse.status).toBe(201);

  const teamPermissionCreatedEvent = await Webhook.findWebhookAttempt(projectId, endpointId, svixToken, event => event.eventType === "team_permission.created");

  expect(teamPermissionCreatedEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_permission.created",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "id": "team_member",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_permission.created",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);
});

it("should trigger multiple permission webhooks when a custom permission is included in default team permissions", async ({ expect }) => {
  // Setup project with webhook support
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { projectId, adminAccessToken } = await Project.createAndGetAdminToken({
    config: {
      magic_link_enabled: true
    }
  });

  // Create a new permission definition
  const createPermissionResponse = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'custom_permission',
      description: 'Custom test permission',
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(createPermissionResponse.status).toBe(201);

  // Update project config to include the custom permission as default team_member permission
  const { updateProjectResponse } = await Project.updateCurrent(adminAccessToken, {
    config: {
      team_member_default_permissions: [{ id: 'team_member' }, { id: 'custom_permission' }],
    },
  });
  expect(updateProjectResponse.status).toBe(200);

  // Setup webhook endpoint
  const svixTokenResponse = await niceBackendFetch("/api/v1/webhooks/svix-token", {
    accessType: "admin",
    method: "POST",
    body: {},
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    }
  });
  const svixToken = svixTokenResponse.body.token;

  const createEndpointResponse = await niceFetch(STACK_SVIX_SERVER_URL + `/api/v1/app/${projectId}/endpoint`, {
    method: "POST",
    body: JSON.stringify({
      url: "https://example.com"
    }),
    headers: {
      "Authorization": `Bearer ${svixToken}`,
      "Content-Type": "application/json",
    },
  });
  const endpointId = createEndpointResponse.body.id;

  // Setup API keys for the project
  await InternalApiKey.createAndSetProjectKeys(adminAccessToken);

  // Create a user and team
  await Auth.Otp.signIn();
  const { teamId } = await Team.createWithCurrentAsCreator();

  await bumpEmailAddress();
  const { userId } = await Auth.Otp.signIn();

  // Add the user to the team
  const addUserResponse = await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  expect(addUserResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Wait for webhooks to be triggered
  await wait(5000);

  // Get webhook events
  const attemptResponse = await Webhook.listWebhookAttempts(projectId, endpointId, svixToken);

  // Check for team_permission.created events
  const teamPermissionCreatedEvents = attemptResponse.filter(event => event.eventType === "team_permission.created");

  // There should be two team permission created events (for both default permissions)
  expect(teamPermissionCreatedEvents.length).toBe(2);

  // Check for the custom permission event
  const customPermissionEvent = teamPermissionCreatedEvents.find(event =>
    event.payload.data.id === "custom_permission"
  );

  expect(customPermissionEvent).toBeDefined();
  expect(customPermissionEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_permission.created",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "id": "custom_permission",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_permission.created",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);

  // Check for the standard team_member permission event
  const memberPermissionEvent = teamPermissionCreatedEvents.find(event =>
    event.payload.data.id === "team_member"
  );

  expect(memberPermissionEvent).toBeDefined();
  expect(memberPermissionEvent).toMatchInlineSnapshot(`
    {
      "channels": null,
      "eventId": null,
      "eventType": "team_permission.created",
      "id": "<stripped svix message id>",
      "payload": {
        "data": {
          "id": "team_member",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "type": "team_permission.created",
      },
      "timestamp": <stripped field 'timestamp'>,
    }
  `);
});
