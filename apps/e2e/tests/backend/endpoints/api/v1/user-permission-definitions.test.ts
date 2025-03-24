import { it } from "../../../../helpers";
import { InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";


it("lists all the user permissions", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch(`/api/v1/user-permission-definitions`, {
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
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team creators",
            "id": "admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "member",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates, updates, and delete a new user permission", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response1 = await niceBackendFetch(`/api/v1/user-permission-definitions`, {
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
  const response2 = await niceBackendFetch(`/api/v1/user-permission-definitions`, {
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
  const response3 = await niceBackendFetch(`/api/v1/user-permission-definitions/p2`, {
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
  const response4 = await niceBackendFetch(`/api/v1/user-permission-definitions`, {
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
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team creators",
            "id": "admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "member",
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
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // delete the permission
  const response5 = await niceBackendFetch(`/api/v1/user-permission-definitions/p1`, {
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
  const response6 = await niceBackendFetch(`/api/v1/user-permission-definitions`, {
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
              "$read_members",
              "$remove_members",
              "$update_team",
            ],
            "description": "Default permission for team creators",
            "id": "admin",
          },
          {
            "contained_permission_ids": [
              "$invite_members",
              "$read_members",
            ],
            "description": "Default permission for team members",
            "id": "member",
          },
          {
            "contained_permission_ids": ["$update_team"],
            "id": "p3",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
