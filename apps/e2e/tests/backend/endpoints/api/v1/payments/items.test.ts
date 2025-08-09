import { describe, expect } from "vitest";
import { it } from "../../../../../helpers";
import { Project, User, niceBackendFetch } from "../../../../backend-helpers";

async function updateConfig(config: any) {
  const response = await niceBackendFetch(`/api/latest/internal/config/override`, {
    accessType: "admin",
    method: "PATCH",
    body: { config_override_string: JSON.stringify(config) },
  });
  expect(response.status).toBe(200);
}

describe("without authentication", () => {
  it("should not be able to get item without access type", async ({ expect }) => {
    await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/latest/payments/items/user-123/test-item");
    expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 400,
          "body": {
            "code": "ACCESS_TYPE_REQUIRED",
            "error": deindent\`
              You must specify an access level for this Stack project. Make sure project API keys are provided (eg. x-stack-publishable-client-key) and you set the x-stack-access-type header to 'client', 'server', or 'admin'.
              
              For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
            \`,
          },
          "headers": Headers {
            "x-stack-known-error": "ACCESS_TYPE_REQUIRED",
            <some fields may have been hidden>,
          },
        }
      `);
  });
});

it("should be able to get item information with valid customer and item IDs", async ({ expect }) => {
  await Project.createAndSwitch();
  await updateConfig({
    payments: {
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
          default: {
            quantity: 0,
          },
        },
      },
    },
  });

  const user = await User.create();
  const response = await niceBackendFetch(`/api/latest/payments/items/${user.userId}/test-item`, {
    accessType: "client",
  });
  expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 200,
          "body": {
            "display_name": "Test Item",
            "id": "test-item",
            "quantity": 0,
          },
          "headers": Headers { <some fields may have been hidden> },
        }
      `);
});

it("should return ItemNotFound error for non-existent item", async ({ expect }) => {
  await Project.createAndSwitch();
  await updateConfig({
    payments: {
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "user",
          default: {
            quantity: 0,
          },
        },
      },
    },
  });

  const user = await User.create();
  const response = await niceBackendFetch(`/api/latest/payments/items/${user.userId}/non-existent-item`, {
    accessType: "client",
  });
  expect(response).toMatchInlineSnapshot(`
        NiceResponse {
          "status": 404,
          "body": {
            "code": "ITEM_NOT_FOUND",
            "details": { "item_id": "non-existent-item" },
            "error": "Item with ID \\\"non-existent-item\\\" not found.",
          },
          "headers": Headers {
            "x-stack-known-error": "ITEM_NOT_FOUND",
            <some fields may have been hidden>,
          },
        }
      `);
});

it("should return ItemCustomerTypeDoesNotMatch error for user accessing team item", async ({ expect }) => {
  await Project.createAndSwitch();
  await updateConfig({
    payments: {
      items: {
        "test-item": {
          displayName: "Test Item",
          customerType: "team",
          default: {
            quantity: 0,
          },
        },
      },
    },
  });

  const user = await User.create();
  const response = await niceBackendFetch(`/api/latest/payments/items/${user.userId}/test-item`, {
    accessType: "client",
  });
  expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "ITEM_CUSTOMER_TYPE_DOES_NOT_MATCH",
          "details": {
            "actual_customer_type": "user",
            "customer_id": "<stripped UUID>",
            "item_customer_type": "team",
            "item_id": "test-item",
          },
          "error": "The user with ID \\"<stripped UUID>\\" is not a valid customer for the item with ID \\"test-item\\". The item is configured to only be available for team customers, but the customer is a user.",
        },
        "headers": Headers {
          "x-stack-known-error": "ITEM_CUSTOMER_TYPE_DOES_NOT_MATCH",
          <some fields may have been hidden>,
        },
      }
    `);
});
