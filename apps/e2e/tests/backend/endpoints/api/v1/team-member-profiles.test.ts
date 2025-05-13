import { expect } from "vitest";
import { it } from "../../../../helpers";
import { Auth, Team, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

async function signInAndCreateTeam() {
  const { userId: userId1 } = await Auth.Otp.signIn();
  const mailbox1 = backendContext.value.mailbox;

  await bumpEmailAddress();
  const { userId: userId2 } = await Auth.Otp.signIn();

  await bumpEmailAddress();
  const { userId: userId3 } = await Auth.Otp.signIn();

  // update names of users
  await niceBackendFetch(`/api/v1/users/${userId1}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "User 1",
    },
  });

  await niceBackendFetch(`/api/v1/users/${userId2}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "User 2",
    },
  });

  await niceBackendFetch(`/api/v1/users/${userId3}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "User 3 (team creator)",
    },
  });

  const { teamId } = await Team.createWithCurrentAsCreator();

  // Add members to team
  await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId1}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await niceBackendFetch(`/api/v1/team-memberships/${teamId}/${userId2}`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Sign back in as user 1
  backendContext.set({
    mailbox: mailbox1,
  });
  const { userId: signedInUserId } = await Auth.Otp.signIn();
  expect(signedInUserId).toBe(userId1);

  // Remove any permissions from user 1
  const permissionsResponse = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}&user_id=${userId1}`, {
    accessType: "server",
    method: "GET",
  });
  expect(permissionsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "id": "team_member",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  for (const permission of permissionsResponse.body.items) {
    await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId1}/${permission.id}`, {
      accessType: "server",
      method: "DELETE",
      body: {},
    });
  }
  const permissionsResponse2 = await niceBackendFetch(`/api/v1/team-permissions?team_id=${teamId}&user_id=${userId1}`, {
    accessType: "server",
    method: "GET",
  });
  expect(permissionsResponse2).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  return { teamId, userId1, userId2, creatorUserId: userId3 };
}


it("lists and updates member profiles in team", async ({ expect }) => {
  await signInAndCreateTeam();
  // Must specify team_id
  const response = await niceBackendFetch(`/api/v1/team-member-profiles`, {
    accessType: "client",
    method: "GET",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "team_id is required for access type client",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("does not have permission to list all members in their own team by default", async ({ expect }) => {
  const { teamId, userId1 } = await signInAndCreateTeam();
  const response1 = await niceBackendFetch(`/api/v1/team-member-profiles?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(response1).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "TEAM_PERMISSION_REQUIRED",
        "details": {
          "permission_id": "$read_members",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "error": "User <stripped UUID> does not have permission $read_members in team <stripped UUID>.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can read own profile", async ({ expect }) => {
  const { teamId, userId1, userId2, creatorUserId } = await signInAndCreateTeam();
  const response2 = await niceBackendFetch(`/api/v1/team-member-profiles?team_id=${teamId}&user_id=me`, {
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
            "display_name": "User 1",
            "profile_image_url": null,
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("can do several operations when granted $read_members permission", async ({ expect }) => {
  const { teamId, userId1, userId2, creatorUserId } = await signInAndCreateTeam();
  // Grant $read_members permission
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId1}/$read_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // List all members in team
  const response3 = await niceBackendFetch(`/api/v1/team-member-profiles?team_id=${teamId}`, {
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
            "display_name": "User 3 (team creator)",
            "profile_image_url": null,
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
          {
            "display_name": "User 1",
            "profile_image_url": null,
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
          {
            "display_name": "User 2",
            "profile_image_url": null,
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Update own profile
  const response4 = await niceBackendFetch(`/api/v1/team-member-profiles/${teamId}/me`, {
    accessType: "client",
    method: "PATCH",
    body: {
      display_name: "Team Member Name Updated",
    },
  });
  expect(response4).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "Team Member Name Updated",
        "profile_image_url": null,
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Update own user display name, profile display name should not be updated
  await niceBackendFetch(`/api/v1/users/${userId1}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "User name updated",
    },
  });

  const response5 = await niceBackendFetch(`/api/v1/team-member-profiles/${teamId}/me`, {
    accessType: "client",
    method: "GET",
  });
  expect(response5).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "Team Member Name Updated",
        "profile_image_url": null,
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Not allowed to update other member profile
  const response6 = await niceBackendFetch(`/api/v1/team-member-profiles/${teamId}/${userId2}`, {
    accessType: "client",
    method: "PATCH",
    body: {
      display_name: "User 2 Updated",
    },
  });
  expect(response6).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Cannot update another user's profile",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Update user display name, profile display name should be updated
  await niceBackendFetch(`/api/v1/users/${userId2}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "User 2 Updated",
    },
  });

  const response7 = await niceBackendFetch(`/api/v1/team-member-profiles/${teamId}/${userId2}`, {
    accessType: "client",
    method: "GET",
  });
  expect(response7).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "display_name": "User 2 Updated",
        "profile_image_url": null,
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
