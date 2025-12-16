import { it } from "../../../../../helpers";
import { Auth, niceBackendFetch, Payments, Project, Team, User } from "../../../../backend-helpers";

it("should allow a signed-in user to read their own billing status", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const { userId } = await Auth.fastSignUp();

  const getInitial = await niceBackendFetch(`/api/v1/payments/billing/user/${userId}`, {
    accessType: "client",
  });
  expect(getInitial).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "default_payment_method": null,
        "has_customer": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const setupIntent = await niceBackendFetch(`/api/v1/payments/payment-method/user/${userId}/setup-intent`, {
    method: "POST",
    accessType: "client",
    body: {},
  });
  expect(setupIntent.status).toBe(200);
  expect(setupIntent.body).toMatchObject({
    client_secret: expect.any(String),
    stripe_account_id: expect.any(String),
  });

  const getAfter = await niceBackendFetch(`/api/v1/payments/billing/user/${userId}`, {
    accessType: "client",
  });
  expect(getAfter).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "default_payment_method": null,
        "has_customer": true,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should reject a signed-in user reading another user's billing status", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const { userId: userId1 } = await Auth.fastSignUp();
  const { userId: userId2 } = await User.create();

  const response = await niceBackendFetch(`/api/v1/payments/billing/user/${userId2}`, {
    accessType: "client",
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Clients can only manage their own billing.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const getOwn = await niceBackendFetch(`/api/v1/payments/billing/user/${userId1}`, {
    accessType: "client",
  });
  expect(getOwn.status).toBe(200);
});

it("should allow a team admin (but not a normal member) to manage team billing", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();

  const { userId: adminUserId } = await Auth.fastSignUp();
  const { teamId } = await Team.create({ accessType: "server" }, { creator_user_id: adminUserId });
  await Team.addPermission(teamId, adminUserId, "team_admin");

  const adminSetupIntent = await niceBackendFetch(`/api/v1/payments/payment-method/team/${teamId}/setup-intent`, {
    method: "POST",
    accessType: "client",
    body: {},
  });
  expect(adminSetupIntent.status).toBe(200);
  expect(adminSetupIntent.body).toMatchObject({
    client_secret: expect.any(String),
    stripe_account_id: expect.any(String),
  });

  const { userId: memberUserId } = await Auth.fastSignUp();
  await Team.addMember(teamId, memberUserId);

  const memberGet = await niceBackendFetch(`/api/v1/payments/billing/team/${teamId}`, {
    accessType: "client",
  });
  expect(memberGet).toMatchInlineSnapshot(`
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
