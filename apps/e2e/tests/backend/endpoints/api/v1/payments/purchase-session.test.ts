import { it } from "../../../../../helpers";
import { Payments, Project, niceBackendFetch } from "../../../../backend-helpers";

it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      code: "invalid-code",
      price_id: "monthly",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": {
        "code": "VERIFICATION_CODE_NOT_FOUND",
        "error": "The verification code does not exist for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "VERIFICATION_CODE_NOT_FOUND",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should error on invalid price_id", async ({ expect }) => {
  await Project.createAndSwitch();
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      code,
      price_id: "invalid-price-id",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Price not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should properly create subscription", async ({ expect }) => {
  await Project.createAndSwitch();
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const response = await niceBackendFetch("/api/latest/payments/purchases/purchase-session", {
    method: "POST",
    accessType: "client",
    body: {
      code,
      price_id: "monthly",
    },
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "client_secret": "" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it.todo("should create purchase URL, validate code, and create purchase session");
