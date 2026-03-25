import { it } from "../../../../../helpers";
import { Auth, Payments, Project, User, niceBackendFetch } from "../../../../backend-helpers";

it("should return empty invoices when payments are not set up", async ({ expect }) => {
  await Project.createAndSwitch();
  const { userId } = await Auth.fastSignUp();

  const response = await niceBackendFetch(`/api/latest/payments/invoices/user/${userId}`, {
    accessType: "client",
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should allow a signed-in user to list their invoices", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  const { userId } = await Auth.fastSignUp();

  const response = await niceBackendFetch(`/api/latest/payments/invoices/user/${userId}`, {
    accessType: "client",
  });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    is_paginated: true,
    items: expect.any(Array),
    pagination: {
      next_cursor: expect.toSatisfy((value: unknown) => value === null || typeof value === "string"),
    },
  });
  for (const invoice of response.body.items as Array<Record<string, unknown>>) {
    expect(invoice).toMatchObject({
      created_at_millis: expect.any(Number),
      status: expect.toSatisfy((value: unknown) => value === null || typeof value === "string"),
      amount_total: expect.any(Number),
      hosted_invoice_url: expect.toSatisfy((value: unknown) => value === null || typeof value === "string"),
    });
  }
});

it("should reject a signed-in user reading another user's invoices", async ({ expect }) => {
  await Project.createAndSwitch();
  await Payments.setup();
  await Auth.fastSignUp();
  const { userId: otherUserId } = await User.create();

  const response = await niceBackendFetch(`/api/latest/payments/invoices/user/${otherUserId}`, {
    accessType: "client",
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 403,
      "body": "Clients can only manage their own billing.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
