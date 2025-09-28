import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Auth, InternalProjectKeys, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../../../backend-helpers";

describe("internal project transfer", () => {
  it("should allow team admin to transfer project to another team they admin", async ({ expect }) => {
    // Set up internal project context
    backendContext.set({ projectKeys: InternalProjectKeys });

    // Create and sign in user in internal project
    const { userId } = await Auth.Otp.signIn();

    // Create two teams where user is admin
    const team1Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 1",
      },
    });
    expect(team1Response.status).toBe(201);
    const team1 = team1Response.body;

    const team2Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 2",
      },
    });
    expect(team2Response.status).toBe(201);
    const team2 = team2Response.body;

    // Add user to both teams first
    await niceBackendFetch(`/api/v1/team-memberships/${team1.id}/${userId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    await niceBackendFetch(`/api/v1/team-memberships/${team2.id}/${userId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Grant team admin permission to user for both teams
    const perm1Response = await niceBackendFetch(`/api/v1/team-permissions/${team1.id}/${userId}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(perm1Response.status).toBe(201);

    const perm2Response = await niceBackendFetch(`/api/v1/team-permissions/${team2.id}/${userId}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(perm2Response.status).toBe(201);

    // Create a project owned by team1
    const projectResponse = await niceBackendFetch("/api/v1/internal/projects", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Test Project",
        owner_team_id: team1.id,
      },
    });
    expect(projectResponse.status).toBe(201);
    const project = projectResponse.body;

    // Verify project is now owned by team2
    const projectDetailsResponse1 = await niceBackendFetch(`/api/v1/internal/projects`, {
      accessType: "admin",
    });
    expect(projectDetailsResponse1.status).toBe(200);
    expect(projectDetailsResponse1.body.items[0].owner_team_id).toBe(team1.id);

    // Transfer project to team2
    const transferResponse = await niceBackendFetch("/api/v1/internal/projects/transfer", {
      method: "POST",
      accessType: "server",
      body: {
        project_id: project.id,
        new_team_id: team2.id,
      },
    });

    expect(transferResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": "true" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify project is now owned by team2
    const projectDetailsResponse2 = await niceBackendFetch(`/api/v1/internal/projects`, {
      accessType: "admin",
    });
    expect(projectDetailsResponse2.status).toBe(200);
    expect(projectDetailsResponse2.body.items[0].owner_team_id).toBe(team2.id);
  });

  it("should not allow non-team-admin to transfer project", async ({ expect }) => {
    // Set up internal project context
    backendContext.set({ projectKeys: InternalProjectKeys });

    // Create admin user
    const adminMailbox = await bumpEmailAddress();
    const { userId: adminUserId } = await Auth.Otp.signIn();

    // Create member user
    const memberMailbox = await bumpEmailAddress();
    const { userId: memberUserId } = await Auth.Otp.signIn();

    // Switch back to admin user
    backendContext.set({ mailbox: adminMailbox });
    await Auth.Otp.signIn();

    const team1Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 1",
      },
    });
    const team1 = team1Response.body;

    const team2Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 2",
      },
    });
    const team2 = team2Response.body;

    // Add adminUserId to both teams first
    await niceBackendFetch(`/api/v1/team-memberships/${team1.id}/${adminUserId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    await niceBackendFetch(`/api/v1/team-memberships/${team2.id}/${adminUserId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Make adminUserId admin of both teams
    await niceBackendFetch(`/api/v1/team-permissions/${team1.id}/${adminUserId}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    await niceBackendFetch(`/api/v1/team-permissions/${team2.id}/${adminUserId}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Add memberUserId as regular member to team1
    await niceBackendFetch(`/api/v1/team-memberships/${team1.id}/${memberUserId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Create a project owned by team1
    const projectResponse = await niceBackendFetch("/api/v1/internal/projects", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Test Project",
        owner_team_id: team1.id,
      },
    });
    const project = projectResponse.body;

    // Switch to member user
    backendContext.set({ mailbox: memberMailbox });
    await Auth.Otp.signIn();

    const transferResponse = await niceBackendFetch("/api/v1/internal/projects/transfer", {
      method: "POST",
      accessType: "server",
      body: {
        project_id: project.id,
        new_team_id: team2.id,
      },
    });

    expect(transferResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "TEAM_PERMISSION_REQUIRED",
          "details": {
            "permission_id": "team_admin",
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
          "error": "User <stripped UUID> does not have permission team_admin in team <stripped UUID>.",
        },
        "headers": Headers {
          "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should allow transfer to team where user is not admin but is a member", async ({ expect }) => {
    // Set up internal project context
    backendContext.set({ projectKeys: InternalProjectKeys });

    // Create user and sign in
    const { userId } = await Auth.Otp.signIn();

    // Create two teams
    const team1Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 1",
      },
    });
    const team1 = team1Response.body;

    const team2Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 2",
      },
    });
    const team2 = team2Response.body;

    // Add user to both teams first
    await niceBackendFetch(`/api/v1/team-memberships/${team1.id}/${userId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Grant team admin permission only for team1
    await niceBackendFetch(`/api/v1/team-permissions/${team1.id}/${userId}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Add user as regular member to team2 (not admin)
    await niceBackendFetch(`/api/v1/team-memberships/${team2.id}/${userId}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Create a project owned by team1
    const projectResponse = await niceBackendFetch("/api/v1/internal/projects", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Test Project",
        owner_team_id: team1.id,
      },
    });
    const project = projectResponse.body;

    // Should be able to transfer project to team2 even though user is not admin there
    const transferResponse = await niceBackendFetch("/api/v1/internal/projects/transfer", {
      method: "POST",
      accessType: "server",
      body: {
        project_id: project.id,
        new_team_id: team2.id,
      },
    });

    expect(transferResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": "true" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify project is now owned by team2
    const projectDetailsResponse = await niceBackendFetch(`/api/v1/internal/projects`, {
      accessType: "admin",
    });
    expect(projectDetailsResponse.status).toBe(200);
    expect(projectDetailsResponse.body.items[0].owner_team_id).toBe(team2.id);
  });

  it("should not allow transfer to team where user is not a member", async ({ expect }) => {
    // Set up internal project context
    backendContext.set({ projectKeys: InternalProjectKeys });

    // Create first user and sign in
    const user1Mailbox = await bumpEmailAddress();
    const { userId: user1Id } = await Auth.Otp.signIn();

    // Create team1 with user1
    const team1Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 1",
      },
    });
    const team1 = team1Response.body;

    // Create second user
    const user2Mailbox = await bumpEmailAddress();
    const { userId: user2Id } = await Auth.Otp.signIn();

    // Create team2 with user2
    const team2Response = await niceBackendFetch("/api/v1/teams", {
      method: "POST",
      accessType: "server",
      body: {
        display_name: "Team 2",
      },
    });
    const team2 = team2Response.body;

    // Sign back in as user1 (call signIn again)
    backendContext.set({ mailbox: user1Mailbox });
    await Auth.Otp.signIn();

    // Add user1 to team1 first
    await niceBackendFetch(`/api/v1/team-memberships/${team1.id}/${user1Id}`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Grant team admin permission for team1 to user1
    await niceBackendFetch(`/api/v1/team-permissions/${team1.id}/${user1Id}/team_admin`, {
      method: "POST",
      accessType: "server",
      body: {},
    });

    // Create a project owned by team1
    const projectResponse = await niceBackendFetch("/api/v1/internal/projects", {
      method: "POST",
      accessType: "admin",
      body: {
        display_name: "Test Project",
        owner_team_id: team1.id,
      },
    });
    const project = projectResponse.body;

    // Try to transfer project to team2 where user1 is not a member
    const transferResponse = await niceBackendFetch("/api/v1/internal/projects/transfer", {
      method: "POST",
      accessType: "server",
      body: {
        project_id: project.id,
        new_team_id: team2.id,
      },
    });

    expect(transferResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": {
          "code": "TEAM_MEMBERSHIP_NOT_FOUND",
          "details": {
            "team_id": "<stripped UUID>",
            "user_id": "<stripped UUID>",
          },
          "error": "User <stripped UUID> is not found in team <stripped UUID>.",
        },
        "headers": Headers {
          "x-stack-known-error": "TEAM_MEMBERSHIP_NOT_FOUND",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});
