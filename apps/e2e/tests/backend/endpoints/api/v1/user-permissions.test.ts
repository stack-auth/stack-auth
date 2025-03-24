import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { ApiKey, Auth, InternalProjectKeys, Project, Team, Webhook, backendContext, niceBackendFetch } from "../../../backend-helpers";

it("is not allowed to list permissions from the other users on the client", async ({ expect }) => {
  await Auth.Otp.signIn();

  const response = await niceBackendFetch(`/api/v1/user-permissions`, {
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

  const response = await niceBackendFetch(`/api/v1/user-permissions/${userId}/does_not_exist`, {
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

  await ApiKey.createAndSetProjectKeys(adminAccessToken);

  const { userId } = await Auth.Password.signUpWithEmail({ password: 'test1234' });

  // list current permissions
  const response1 = await niceBackendFetch(`/api/v1/user-permissions?user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // grant new permission
  const response2 = await niceBackendFetch(`/api/v1/user-permissions/${userId}/parent`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(response2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "id": "parent",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // list current permissions (should have the new permission)
  const response3 = await niceBackendFetch(`/api/v1/user-permissions?user_id=me`, {
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
            "id": "parent",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

// TODO: add user default permissions to the project config
it.todo("can customize default user permissions", async ({ expect }) => {
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
  expect(response1).toMatchInlineSnapshot();

  const { updateProjectResponse: response2 } = await Project.updateCurrent(adminAccessToken, {
    config: {
      // user_default_permissions: [{ id: 'test' }],
    },
  });

  await ApiKey.createAndSetProjectKeys(adminAccessToken);

  expect(response2).toMatchInlineSnapshot();
});
