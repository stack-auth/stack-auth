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

it("cannot create a project permission that contains a permission that doesn't exist", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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

it("cannot create a project permission that contains a team permission", async ({ expect }) => {
  await Project.createAndSwitch();

  const response = await niceBackendFetch(`/api/v1/team-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: { id: 't1' },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contained_permission_ids": [],
        "id": "t1",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const response2 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
    accessType: "admin",
    method: "POST",
    body: { id: 'p1', contained_permission_ids: ['t1'] },
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CONTAINED_PERMISSION_NOT_FOUND",
        "details": { "permission_id": "t1" },
        "error": "Contained permission with ID \\"t1\\" not found. Make sure you created it on the dashboard.",
      },
      "headers": Headers {
        "x-stack-known-error": "CONTAINED_PERMISSION_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("cannot update a project permission definition to contain a permission that doesn't exist", async ({ expect }) => {
  await Project.createAndSwitch();

  const response1 = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
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

  const response2 = await niceBackendFetch(`/api/v1/project-permission-definitions/p1`, {
    accessType: "admin",
    method: "PATCH",
    body: { id: 'p1', contained_permission_ids: ['p2'] },
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

it("paginates and filters project permission definitions via limit, cursor, and query", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  const { adminAccessToken } = await Project.createAndGetAdminToken();

  // Seed enough definitions so we can paginate
  const seededIds = ["perm_alpha", "perm_beta", "perm_gamma", "perm_delta"];
  for (const id of seededIds) {
    const create = await niceBackendFetch(`/api/v1/project-permission-definitions`, {
      accessType: "admin",
      method: "POST",
      headers: { 'x-stack-admin-access-token': adminAccessToken },
      body: { id, description: `Description for ${id}` },
    });
    expect(create.status).toBe(201);
  }

  // Page 1 with limit=2 should return 2 items + a cursor
  const page1 = await niceBackendFetch(`/api/v1/project-permission-definitions?limit=2`, {
    accessType: "admin",
    method: "GET",
    headers: { 'x-stack-admin-access-token': adminAccessToken },
  });
  expect(page1.status).toBe(200);
  expect(page1.body.is_paginated).toBe(true);
  expect(page1.body.items.length).toBe(2);
  expect(page1.body.pagination.next_cursor).not.toBeNull();

  // Page 2 using the cursor returns subsequent items with no overlap
  const cursor = page1.body.pagination.next_cursor;
  const page2 = await niceBackendFetch(`/api/v1/project-permission-definitions?limit=2&cursor=${encodeURIComponent(cursor)}`, {
    accessType: "admin",
    method: "GET",
    headers: { 'x-stack-admin-access-token': adminAccessToken },
  });
  expect(page2.status).toBe(200);
  expect(page2.body.is_paginated).toBe(true);
  const page1Ids = new Set(page1.body.items.map((p: any) => p.id));
  for (const item of page2.body.items) {
    expect(page1Ids.has(item.id)).toBe(false);
  }

  // `query` matches case-insensitively on id and description
  const queryResp = await niceBackendFetch(`/api/v1/project-permission-definitions?query=ALPHA`, {
    accessType: "admin",
    method: "GET",
    headers: { 'x-stack-admin-access-token': adminAccessToken },
  });
  expect(queryResp.status).toBe(200);
  expect(queryResp.body.items.some((p: any) => p.id === "perm_alpha")).toBe(true);
  for (const item of queryResp.body.items) {
    const haystack = `${item.id} ${item.description ?? ""}`.toLowerCase();
    expect(haystack.includes("alpha")).toBe(true);
  }

  // `cursor` requires `limit`
  const badCursor = await niceBackendFetch(`/api/v1/project-permission-definitions?cursor=perm_alpha`, {
    accessType: "admin",
    method: "GET",
    headers: { 'x-stack-admin-access-token': adminAccessToken },
  });
  expect(badCursor.status).toBe(400);
});
