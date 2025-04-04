import { it } from "../../../../helpers";
import { InternalProjectKeys, Project, backendContext, niceBackendFetch } from "../../../backend-helpers";


it("lists all the user permissions", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
        "items": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("creates, updates, and deletes a new user permission", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  const response1 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
  const response2 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p2',
      contained_permission_ids: ['p1']
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": ["p1"],
        "id": "p2",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // test recursive case
  const response3 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: {
      id: 'p3',
      contained_permission_ids: ['p2']
    },
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });

  expect(response3).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": ["p2"],
        "id": "p3",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // list all permissions again
  const response4 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
            "id": "p1",
          },
          {
            "contained_permission_ids": ["p1"],
            "id": "p2",
          },
          {
            "contained_permission_ids": ["p2"],
            "id": "p3",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // delete the permission
  const response5 = await niceBackendFetch(`/api/v1/project-permission-definitions/p1`, {
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
  const response6 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
            "id": "p2",
          },
          {
            "contained_permission_ids": ["p2"],
            "id": "p3",
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
  const response1 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
  const response2 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
  const response3 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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
  const response4 = await niceBackendFetch(`/api/v1/project-permission-definitions/duplicate_test`, {
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
  await niceBackendFetch(`/api/v1/project-permission-definitions/duplicate_test`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
  await niceBackendFetch(`/api/v1/project-permission-definitions/update_test`, {
    accessType: "admin",
    method: "DELETE",
    headers: {
      'x-stack-admin-access-token': adminAccessToken
    },
  });
});
