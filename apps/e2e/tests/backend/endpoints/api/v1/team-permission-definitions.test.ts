import { it } from "../../../../helpers";
import { InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";


it("lists all the team permissions", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "GET",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "contained_permission_ids": [],
            "description": "Delete the team",
            "id": "$delete_team",
          },
          {
            "contained_permission_ids": [],
            "description": "Invite other users to the team",
            "id": "$invite_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Create and manage API keys for the team",
            "id": "$manage_api_keys",
          },
          {
            "contained_permission_ids": [],
            "description": "Read and list the other members of the team",
            "id": "$read_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Remove other members from the team",
            "id": "$remove_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Update the team information",
            "id": "$update_team",
          },
          {
            "contained_permission_ids": [
              "$delete_team",
              "$invite_members",
              "$manage_api_keys",
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team admins",
            "id": "team_admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "team_member",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates, updates, and delete a new team permission", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response1 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p1'
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
        "id": "p1",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // create another permission with contained permissions
  const response2 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p2',
      contained_permission_ids: ['p1', '$read_members']
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": [
          "$read_members",
          "p1",
        ],
        "id": "p2",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // update the permission
  const response3 = await niceBackendFetch(`/api/v1/team-permission-definitions/p2`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      id: 'p3',
      contained_permission_ids: ['p1', '$update_team']
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });

  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "contained_permission_ids": [
          "$update_team",
          "p1",
        ],
        "id": "p3",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // list all permissions again
  const response4 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "GET",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "contained_permission_ids": [],
            "description": "Delete the team",
            "id": "$delete_team",
          },
          {
            "contained_permission_ids": [],
            "description": "Invite other users to the team",
            "id": "$invite_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Create and manage API keys for the team",
            "id": "$manage_api_keys",
          },
          {
            "contained_permission_ids": [],
            "description": "Read and list the other members of the team",
            "id": "$read_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Remove other members from the team",
            "id": "$remove_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Update the team information",
            "id": "$update_team",
          },
          {
            "contained_permission_ids": [],
            "id": "p1",
          },
          {
            "contained_permission_ids": [
              "$update_team",
              "p1",
            ],
            "id": "p3",
          },
          {
            "contained_permission_ids": [
              "$delete_team",
              "$invite_members",
              "$manage_api_keys",
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team admins",
            "id": "team_admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "team_member",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // delete the permission
  const response5 = await niceBackendFetch(`/api/v1/team-permission-definitions/p1`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response5).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // list all permissions again
  const response6 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "GET",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response6).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "contained_permission_ids": [],
            "description": "Delete the team",
            "id": "$delete_team",
          },
          {
            "contained_permission_ids": [],
            "description": "Invite other users to the team",
            "id": "$invite_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Create and manage API keys for the team",
            "id": "$manage_api_keys",
          },
          {
            "contained_permission_ids": [],
            "description": "Read and list the other members of the team",
            "id": "$read_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Remove other members from the team",
            "id": "$remove_members",
          },
          {
            "contained_permission_ids": [],
            "description": "Update the team information",
            "id": "$update_team",
          },
          {
            "contained_permission_ids": ["$update_team"],
            "id": "p3",
          },
          {
            "contained_permission_ids": [
              "$delete_team",
              "$invite_members",
              "$manage_api_keys",
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team admins",
            "id": "team_admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "team_member",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("handles duplicate permission IDs correctly", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Create first permission
  const response1 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'duplicate_test',
      description: "Test permission"
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response1.status).toBe(201);

  // Try to create another permission with the same ID
  const response2 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'duplicate_test',
      description: "Another test permission"
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response2.status).toBe(400);
  expect(response2.body).toHaveProperty("code", "PERMISSION_ID_ALREADY_EXISTS");

  // Create another permission
  const response3 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'update_test',
      description: "Test permission for update"
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response3.status).toBe(201);

  // Update the first permission to have the ID of the second (which should fail)
  const response4 = await niceBackendFetch(`/api/v1/team-permission-definitions/duplicate_test`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      id: 'update_test',
      description: "Updated description"
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });

  expect(response4.status).toBe(400);
  expect(response4.body).toHaveProperty("code", "PERMISSION_ID_ALREADY_EXISTS");

  // Clean up
  await niceBackendFetch(`/api/v1/team-permission-definitions/duplicate_test`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  await niceBackendFetch(`/api/v1/team-permission-definitions/update_test`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
});

it("cannot create a team permission that contains a permission that doesn't exist", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p1',
      contained_permission_ids: ['p2']
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CONTAINED_PERMISSION_NOT_FOUND",
        "details": { "permission_id": "p2" },
        "error": "Contained permission with ID \\"p2\\" not found. Make sure you created it on the dashboard.",
      },
      "headers": Headers {
        "x-stack-known-error": "CONTAINED_PERMISSION_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("cannot create a team permission that contains a project permission", async ({ expect }) => {
  await Project.createAndSwitch();

  const response1 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: { id: 'p2' },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": [],
        "id": "p2",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response2 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p1',
      contained_permission_ids: ['p2']
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CONTAINED_PERMISSION_NOT_FOUND",
        "details": { "permission_id": "p2" },
        "error": "Contained permission with ID \\"p2\\" not found. Make sure you created it on the dashboard.",
      },
      "headers": Headers {
        "x-stack-known-error": "CONTAINED_PERMISSION_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("cannot update a team permission definition to contain a permission that doesn't exist", async ({ expect }) => {
  await Project.createAndSwitch();

  const response1 = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: { id: 'p1' },
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": [],
        "id": "p1",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response2 = await niceBackendFetch(`/api/v1/team-permission-definitions/p1`, {
    accessType: "admin",
    method: "PATCH",
    body: {
      id: 'p1',
      contained_permission_ids: ['p2']
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CONTAINED_PERMISSION_NOT_FOUND",
        "details": { "permission_id": "p2" },
        "error": "Contained permission with ID \\"p2\\" not found. Make sure you created it on the dashboard.",
      },
      "headers": Headers {
        "x-stack-known-error": "CONTAINED_PERMISSION_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});
