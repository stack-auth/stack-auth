import { it } from "../../../../../helpers";
import { Payments, Project, niceBackendFetch } from "../../../../backend-helpers";


it("should error on invalid code", async ({ expect }) => {
  await Project.createAndSwitch();
  const response = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: {
      full_code: "invalid-code",
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

it("should allow valid code and return offer data", async ({ expect }) => {
  const { code } = await Payments.createPurchaseUrlAndGetCode();
  const validateResponse = await niceBackendFetch("/api/latest/payments/purchases/validate-code", {
    method: "POST",
    accessType: "client",
    body: { full_code: code },
  });
  expect(validateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "offer": {
          "customer_type": "user",
          "display_name": "Test Offer",
          "prices": {
            "monthly": {
              "USD": "1000",
              "interval": [
                1,
                "month",
              ],
            },
          },
        },
        "stripe_account_id": "acct_test123",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
