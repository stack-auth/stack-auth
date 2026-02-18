import { expect } from "vitest";
import { it } from "../../../../helpers";
import { Auth, InternalProjectKeys, Project, Team, User, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

async function createAndAddCurrentUserWithoutMemberPermission() {
  const { teamId } = await Team.create();
  const user = await User.getCurrent();
  await Team.addMember(teamId, user.id);
  const response = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${user.id}/team_member`, {
    accessType: "server",
    method: "DELETE",
    body: {},
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  return {
    teamId,
  };
}

it("requires $invite_members permission to send invitation", async ({ expect }) => {
  await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  const sendTeamInvitationResponse = await niceBackendFetch("/api/v1/team-invitations/send-code", {
    method: "POST",
    accessType: "client",
    body: {
      email: "some-email-test@example.com",
      team_id: teamId,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });

  expect(sendTeamInvitationResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "TEAM_PERMISSION_REQUIRED",
        "details": {
          "permission_id": "$invite_members",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "error": "User <stripped UUID> does not have permission $invite_members in team <stripped UUID>.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("can send invitation", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId: userId1 } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  const receiveMailbox = createMailbox();

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${userId1}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });


  await Team.sendInvitation(receiveMailbox, teamId);

  backendContext.set({ mailbox: receiveMailbox });
  await Auth.fastSignUp({ primary_email: receiveMailbox.emailAddress, primary_email_verified: true });

  await Team.acceptInvitation();

  const response = await niceBackendFetch(`/api/v1/teams?user_id=me`, {
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
            "client_metadata": null,
            "client_read_only_metadata": null,
            "created_at_millis": <stripped field 'created_at_millis'>,
            "display_name": "New Team",
            "id": "<stripped UUID>",
            "profile_image_url": null,
            "server_metadata": null,
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("can send invitation without a current user on the server", async ({ expect }) => {
  const { teamId } = await Team.create();
  const receiveMailbox = createMailbox();

  backendContext.set({ userAuth: null });
  const sendTeamInvitationResponse = await niceBackendFetch("/api/v1/team-invitations/send-code", {
    method: "POST",
    accessType: "server",
    body: {
      email: receiveMailbox.emailAddress,
      team_id: teamId,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });

  expect(sendTeamInvitationResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "id": "<stripped UUID>",
        "success": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({ mailbox: receiveMailbox });
  await Auth.fastSignUp({ primary_email: receiveMailbox.emailAddress, primary_email_verified: true });
  await Team.acceptInvitation();

  const response = await niceBackendFetch(`/api/v1/teams?user_id=me`, {
    accessType: "server",
    method: "GET",
  });
  expect(response.body.items).toHaveLength(2);
  expect(response.body.items.find((item: any) => item.display_name === "New Team")).toBeDefined();
});


it("can list invitations on the server", async ({ expect }) => {
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await Team.sendInvitation("some-email-test@example.com", teamId);

  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(listInvitationsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "recipient_email": "some-email-test@example.com",
            "team_display_name": "New Team",
            "team_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("can't list invitations without team_id or user_id", async ({ expect }) => {
  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations`, {
    accessType: "server",
    method: "GET",
  });
  expect(listInvitationsResponse.status).toBe(400);
});


it("allows team admins to list invitations", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await Team.sendInvitation("some-email-test@example.com", teamId);

  const { userId: teamAdmin } = await Auth.fastSignUp();
  await Team.addMember(teamId, teamAdmin);

  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(listInvitationsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "recipient_email": "some-email-test@example.com",
            "team_display_name": "New Team",
            "team_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("requires $invite_members permission to list invitations", async ({ expect }) => {
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  // Create an invitation to list
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await Team.sendInvitation("some-email-test@example.com", teamId);

  const { userId: teamAdmin } = await Auth.fastSignUp();
  await Team.addMember(teamId, teamAdmin);

  const deletePermissionResponse = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/team_member`, {
    accessType: "server",
    method: "DELETE",
    body: {},
  });
  expect(deletePermissionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const grantPermissionResponse = await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/$read_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(grantPermissionResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "id": "$read_members",
        "team_id": "<stripped UUID>",
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(listInvitationsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "TEAM_PERMISSION_REQUIRED",
        "details": {
          "permission_id": "$invite_members",
          "team_id": "<stripped UUID>",
          "user_id": "<stripped UUID>",
        },
        "error": "User <stripped UUID> does not have permission $invite_members in team <stripped UUID>.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_PERMISSION_REQUIRED",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("requires $read_members permission to list invitations", async ({ expect }) => {
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  const { sendTeamInvitationResponse } = await Team.sendInvitation("some-email-test@example.com", teamId);

  const { userId: teamAdmin } = await Auth.fastSignUp();
  await Team.addMember(teamId, teamAdmin);
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/team_member`, {
    accessType: "server",
    method: "DELETE",
    body: {},
  });

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(listInvitationsResponse).toMatchInlineSnapshot(`
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

it("allows team admins to revoke invitations", async ({ expect }) => {
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  const { sendTeamInvitationResponse } = await Team.sendInvitation("some-email-test@example.com", teamId);
  const invitationId = sendTeamInvitationResponse.body.id;

  const { userId: teamAdmin } = await Auth.fastSignUp();
  await Team.addMember(teamId, teamAdmin);

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/$remove_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  const revokeInvitationResponse = await niceBackendFetch(`/api/v1/team-invitations/${invitationId}?team_id=${teamId}`, {
    accessType: "client",
    method: "DELETE",
  });
  expect(revokeInvitationResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${teamAdmin}/$read_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  const listInvitationsResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(listInvitationsResponse).toMatchInlineSnapshot(`
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


it("requires $remove_members permission to revoke invitations", async ({ expect }) => {
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviter}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });
  const { sendTeamInvitationResponse } = await Team.sendInvitation("some-email-test@example.com", teamId);
  const invitationId = sendTeamInvitationResponse.body.id;

  const { userId: teamAdmin } = await Auth.fastSignUp();
  await Team.addMember(teamId, teamAdmin);

  const revokeInvitationResponse = await niceBackendFetch(`/api/v1/team-invitations/${invitationId}?team_id=${teamId}`, {
    accessType: "client",
    method: "DELETE",
  });
  expect(revokeInvitationResponse).toMatchInlineSnapshot(`
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
});


it("errors with item_quantity_insufficient_amount when accepting invite without remaining dashboard_admins", async ({ expect }) => {
  backendContext.set({ projectKeys: InternalProjectKeys });
  await Auth.fastSignUp({});
  const { createProjectResponse } = await Project.create({ display_name: "Test Project (Insufficient Admins)" });
  const ownerTeamId: string = createProjectResponse.body.owner_team_id;
  const mailboxB = createMailbox();
  const sendInvitationResponse = await niceBackendFetch("/api/v1/team-invitations/send-code", {
    method: "POST",
    accessType: "server",
    body: {
      email: mailboxB.emailAddress,
      team_id: ownerTeamId,
      callback_url: "http://localhost:12345/some-callback-url",
    },
  });
  expect(sendInvitationResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "id": "<stripped UUID>",
        "success": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({ mailbox: mailboxB });
  await Auth.fastSignUp({ primary_email: mailboxB.emailAddress, primary_email_verified: true });

  const invitationMessages = await mailboxB.waitForMessagesWithSubject("join");
  const acceptResponse = await niceBackendFetch("/api/v1/team-invitations/accept", {
    method: "POST",
    accessType: "client",
    body: {
      code: invitationMessages.findLast((m) => m.subject.includes("join"))?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9]+)/)?.[1],
    },
  });

  expect(acceptResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "ITEM_QUANTITY_INSUFFICIENT_AMOUNT",
        "details": {
          "customer_id": "<stripped UUID>",
          "item_id": "dashboard_admins",
          "quantity": -1,
        },
        "error": "The item with ID \\"dashboard_admins\\" has an insufficient quantity for the customer with ID \\"<stripped UUID>\\". An attempt was made to charge -1 credits.",
      },
      "headers": Headers {
        "x-stack-known-error": "ITEM_QUANTITY_INSUFFICIENT_AMOUNT",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should error when untrusted callback URL is provided", async ({ expect }) => {
  const { teamId } = await Team.create();
  const receiveMailbox = createMailbox();

  backendContext.set({ userAuth: null });
  const sendTeamInvitationResponse = await niceBackendFetch("/api/v1/team-invitations/send-code", {
    method: "POST",
    accessType: "server",
    body: {
      email: receiveMailbox.emailAddress,
      team_id: teamId,
      callback_url: "https://malicious.com/callback",
    },
  });

  expect(sendTeamInvitationResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "REDIRECT_URL_NOT_WHITELISTED",
        "error": "Redirect URL not whitelisted. Did you forget to add this domain to the trusted domains list on the Stack Auth dashboard?",
      },
      "headers": Headers {
        "x-stack-known-error": "REDIRECT_URL_NOT_WHITELISTED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not allow restricted users (unverified email) to accept team invitations", async ({ expect }) => {
  // Create a project with email verification required
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      credential_enabled: true,
    },
  });
  await Project.updateConfig({
    onboarding: { requireEmailVerification: true },
  });

  // Create a verified user to send the invitation
  const { userId: inviterId } = await Auth.Otp.signIn();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  // Grant invite permission to the inviter
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviterId}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Send team invitation
  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox, teamId);

  // Create a restricted user (unverified email) via credential sign-up
  const restrictedMailbox = createMailbox();
  const signUpResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    body: {
      email: restrictedMailbox.emailAddress,
      password: "test-password-123",
      verification_callback_url: "http://localhost:12345/verify",
    },
  });
  expect(signUpResponse.status).toBe(200);

  // Update context with new user's tokens
  backendContext.set({
    userAuth: {
      accessToken: signUpResponse.body.access_token,
      refreshToken: signUpResponse.body.refresh_token,
    },
  });

  // Verify the user is restricted
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-allow-restricted-user": "true",
    },
  });
  expect(userResponse.body.is_restricted).toBe(true);
  expect(userResponse.body.restricted_reason).toEqual({ type: "email_not_verified" });

  // Get the invitation code from the email
  const invitationMessages = await receiveMailbox.waitForMessagesWithSubject("join");
  const invitationCode = invitationMessages.findLast((m) => m.subject.includes("join"))?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9_]+)/)?.[1];
  expect(invitationCode).toBeDefined();

  // Try to accept the invitation as a restricted user
  const acceptResponse = await niceBackendFetch("/api/v1/team-invitations/accept", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-allow-restricted-user": "true",
    },
    body: {
      code: invitationCode,
    },
  });

  expect(acceptResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        "details": { "restricted_reason": { "type": "email_not_verified" } },
        "error": "Restricted users cannot accept team invitations. Reason: email_not_verified. Please complete the onboarding process before accepting team invitations.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not allow anonymous users to accept team invitations", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  // Create a verified user to send the invitation
  const { userId: inviterId } = await Auth.Otp.signIn();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  // Grant invite permission to the inviter
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviterId}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Send team invitation
  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox, teamId);

  // Create an anonymous user
  const anonResponse = await niceBackendFetch("/api/v1/auth/anonymous/sign-up", {
    method: "POST",
    accessType: "client",
    body: {},
  });
  expect(anonResponse.status).toBe(200);

  // Update context with anonymous user's tokens
  backendContext.set({
    userAuth: {
      accessToken: anonResponse.body.access_token,
      refreshToken: anonResponse.body.refresh_token,
    },
  });

  // Verify the user is anonymous and restricted
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
    headers: {
      "x-stack-allow-restricted-user": "true",
    },
  });
  expect(userResponse.body.is_anonymous).toBe(true);
  expect(userResponse.body.is_restricted).toBe(true);
  expect(userResponse.body.restricted_reason).toEqual({ type: "anonymous" });

  // Get the invitation code from the email
  const invitationMessages = await receiveMailbox.waitForMessagesWithSubject("join");
  const invitationCode = invitationMessages.findLast((m) => m.subject.includes("join"))?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9_]+)/)?.[1];
  expect(invitationCode).toBeDefined();

  // Try to accept the invitation as an anonymous user
  const acceptResponse = await niceBackendFetch("/api/v1/team-invitations/accept", {
    method: "POST",
    accessType: "client",
    headers: {
      "x-stack-allow-anonymous-user": "true",
    },
    body: {
      code: invitationCode,
    },
  });

  expect(acceptResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        "details": { "restricted_reason": { "type": "anonymous" } },
        "error": "Restricted users cannot accept team invitations. Reason: anonymous. Please complete the onboarding process before accepting team invitations.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should not allow restricted users to get team invitation details", async ({ expect }) => {
  // Create a project with email verification required
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      credential_enabled: true,
    },
  });
  await Project.updateConfig({
    onboarding: { requireEmailVerification: true },
  });

  // Create a verified user to send the invitation
  const { userId: inviterId } = await Auth.Otp.signIn();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  // Grant invite permission to the inviter
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviterId}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Send team invitation
  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox, teamId);

  // Create a restricted user (unverified email) via credential sign-up
  const restrictedMailbox = createMailbox();
  const signUpResponse = await niceBackendFetch("/api/v1/auth/password/sign-up", {
    method: "POST",
    accessType: "client",
    body: {
      email: restrictedMailbox.emailAddress,
      password: "test-password-123",
      verification_callback_url: "http://localhost:12345/verify",
    },
  });
  expect(signUpResponse.status).toBe(200);

  // Update context with new user's tokens
  backendContext.set({
    userAuth: {
      accessToken: signUpResponse.body.access_token,
      refreshToken: signUpResponse.body.refresh_token,
    },
  });

  // Get the invitation code from the email
  const invitationMessages = await receiveMailbox.waitForMessagesWithSubject("join");
  const invitationCode = invitationMessages.findLast((m) => m.subject.includes("join"))?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9_]+)/)?.[1];
  expect(invitationCode).toBeDefined();

  // Try to get invitation details as a restricted user (without allowing restricted)
  const detailsResponse = await niceBackendFetch("/api/v1/team-invitations/accept/details", {
    method: "POST",
    accessType: "client",
    body: {
      code: invitationCode,
    },
  });

  expect(detailsResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": {
        "code": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        "details": { "restricted_reason": { "type": "email_not_verified" } },
        "error": "Restricted users cannot accept team invitations. Reason: email_not_verified. Please complete the onboarding process before accepting team invitations.",
      },
      "headers": Headers {
        "x-stack-known-error": "TEAM_INVITATION_RESTRICTED_USER_NOT_ALLOWED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should allow a restricted user to accept invitation after verifying email", async ({ expect }) => {
  // Create a project with email verification required
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      credential_enabled: true,
    },
  });
  await Project.updateConfig({
    onboarding: { requireEmailVerification: true },
  });

  // Create a verified user to send the invitation
  const { userId: inviterId } = await Auth.Otp.signIn();
  const { teamId } = await createAndAddCurrentUserWithoutMemberPermission();

  // Grant invite permission to the inviter
  await niceBackendFetch(`/api/v1/team-permissions/${teamId}/${inviterId}/$invite_members`, {
    accessType: "server",
    method: "POST",
    body: {},
  });

  // Send team invitation
  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox, teamId);

  // Get the invitation code from the email
  const invitationMessages = await receiveMailbox.waitForMessagesWithSubject("join");
  const invitationCode = invitationMessages.findLast((m) => m.subject.includes("join"))?.body?.text.match(/http:\/\/localhost:12345\/some-callback-url\?code=([a-zA-Z0-9_]+)/)?.[1];
  expect(invitationCode).toBeDefined();

  // Sign in with OTP using the same email (this verifies the email)
  backendContext.set({ mailbox: receiveMailbox });
  await Auth.Otp.signIn();

  // Verify the user is NOT restricted
  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "client",
  });
  expect(userResponse.body.is_restricted).toBe(false);
  expect(userResponse.body.primary_email_verified).toBe(true);

  // Accept the invitation should work now
  const acceptResponse = await niceBackendFetch("/api/v1/team-invitations/accept", {
    method: "POST",
    accessType: "client",
    body: {
      code: invitationCode,
    },
  });

  expect(acceptResponse.status).toBe(200);

  // Verify user is now a member of the team
  const teamsResponse = await niceBackendFetch(`/api/v1/teams?user_id=me`, {
    accessType: "server",
    method: "GET",
  });
  expect(teamsResponse.body.items.find((item: any) => item.id === teamId)).toBeDefined();
});


it("can list invitations by user_id on the server", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await Team.create();

  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox.emailAddress, teamId);

  // Create a new user with the invited email as a verified contact channel
  const { userId: invitedUserId } = await Auth.fastSignUp({
    primary_email: receiveMailbox.emailAddress,
    primary_email_verified: true,
  });

  // List invitations for the invited user
  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=${invitedUserId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "recipient_email": "${receiveMailbox.emailAddress}",
            "team_display_name": "New Team",
            "team_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("can list invitations by user_id=me on the client", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId: inviter } = await Auth.fastSignUp();
  const { teamId } = await Team.create();

  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox.emailAddress, teamId);

  // Sign up as the invited user with verified email
  backendContext.set({ mailbox: receiveMailbox });
  await Auth.fastSignUp({
    primary_email: receiveMailbox.emailAddress,
    primary_email_verified: true,
  });

  // List invitations for the current user
  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "expires_at_millis": <stripped field 'expires_at_millis'>,
            "id": "<stripped UUID>",
            "recipient_email": "${receiveMailbox.emailAddress}",
            "team_display_name": "New Team",
            "team_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("returns empty list when user has no verified emails matching invitations", async ({ expect }) => {
  await Project.createAndSwitch();
  await Auth.fastSignUp();
  const { teamId } = await Team.create();
  await Team.sendInvitation("unrelated@example.com", teamId);

  // Sign up as a different user
  const { userId: otherUserId } = await Auth.fastSignUp({
    primary_email: "other@example.com",
    primary_email_verified: true,
  });

  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=${otherUserId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(listResponse).toMatchInlineSnapshot(`
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


it("does not return invitations for unverified emails", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      credential_enabled: true,
    },
  });
  await Auth.fastSignUp();
  const { teamId } = await Team.create();

  const receiveMailbox = createMailbox();
  await Team.sendInvitation(receiveMailbox.emailAddress, teamId);

  // Create a user with the same email but NOT verified
  const { userId: unverifiedUserId } = await Auth.fastSignUp({
    primary_email: receiveMailbox.emailAddress,
    primary_email_verified: false,
  });

  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=${unverifiedUserId}`, {
    accessType: "server",
    method: "GET",
  });
  expect(listResponse).toMatchInlineSnapshot(`
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


it("cannot specify both team_id and user_id", async ({ expect }) => {
  await Auth.fastSignUp();
  const { teamId } = await Team.create();

  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?team_id=${teamId}&user_id=me`, {
    accessType: "server",
    method: "GET",
  });
  expect(listResponse.status).toBe(400);
});


it("must specify either team_id or user_id", async ({ expect }) => {
  await Auth.fastSignUp();

  const listResponse = await niceBackendFetch(`/api/v1/team-invitations`, {
    accessType: "server",
    method: "GET",
  });
  expect(listResponse.status).toBe(400);
});


it("client cannot list invitations for a user_id other than 'me'", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId: otherUserId } = await Auth.fastSignUp({
    primary_email: "other@example.com",
    primary_email_verified: true,
  });

  // Sign in as a different user
  await Auth.fastSignUp();

  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=${otherUserId}`, {
    accessType: "client",
    method: "GET",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        "error": "You have specified 'me' as a userId, but did not provide authentication for a user. Make sure to pass the x-stack-access-token header to authenticate as a user.",
      },
      "headers": Headers {
        "x-stack-known-error": "CANNOT_GET_OWN_USER_WITHOUT_USER",
        <some fields may have been hidden>,
      },
    }
  `);
});


it("can accept invitation by ID", async ({ expect }) => {
  await Project.createAndSwitch();
  await Auth.fastSignUp();
  const { teamId } = await Team.create();

  const receiveMailbox = createMailbox();
  const { sendTeamInvitationResponse } = await Team.sendInvitation(receiveMailbox.emailAddress, teamId);
  const invitationId = sendTeamInvitationResponse.body.id;

  // Sign up as the invited user with the matching verified email
  backendContext.set({ mailbox: receiveMailbox });
  await Auth.fastSignUp({
    primary_email: receiveMailbox.emailAddress,
    primary_email_verified: true,
  });

  // Accept the invitation by ID
  const acceptResponse = await niceBackendFetch(`/api/v1/team-invitations/${invitationId}/accept?user_id=me`, {
    accessType: "client",
    method: "POST",
  });
  expect(acceptResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {},
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  // Verify the user is now a member
  const teamsResponse = await niceBackendFetch(`/api/v1/teams?user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(teamsResponse.body.items.find((item: any) => item.id === teamId)).toBeDefined();

  // Verify the invitation is consumed (no longer listed)
  const listResponse = await niceBackendFetch(`/api/v1/team-invitations?user_id=me`, {
    accessType: "client",
    method: "GET",
  });
  expect(listResponse.body.items).toHaveLength(0);
});
