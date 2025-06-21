import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, niceBackendFetch } from "../../../backend-helpers";

describe("invalid requests", () => {
  it("should return 401 when invalid authorization is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      `/api/v1/emails/notification-preference/me/${randomUUID()}`,
      {
        method: "PATCH",
        accessType: "client",
        body: {
          enabled: true,
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "CANNOT_GET_OWN_USER_WITHOUT_USER",
          "error": "You have specified 'me' as a userId, but did not provide authentication for a user.",
        },
        "headers": Headers {
          "x-stack-known-error": "CANNOT_GET_OWN_USER_WITHOUT_USER",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 404 when invalid notification category id is provided", async ({ expect }) => {
    await Auth.Otp.signIn();
    const response = await niceBackendFetch(
      `/api/v1/emails/notification-preference/me/${randomUUID()}`,
      {
        method: "PATCH",
        accessType: "client",
        body: {
          enabled: true,
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": "Notification category not found",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

it("lists default notification preferences", async ({ expect }) => {
  await Auth.Otp.signIn();
  const response = await niceBackendFetch(
    "/api/v1/emails/notification-preference/me",
    {
      method: "GET",
      accessType: "client",
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "can_disable": false,
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Transactional",
          },
          {
            "can_disable": true,
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Marketing",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("updates notification preferences", async ({ expect }) => {
  await Auth.Otp.signIn();
  const response = await niceBackendFetch(
    "/api/v1/emails/notification-preference/me/4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
    {
      method: "PATCH",
      accessType: "client",
      body: {
        enabled: false,
      }
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "can_disable": true,
        "enabled": false,
        "notification_category_id": "<stripped UUID>",
        "notification_category_name": "Marketing",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listPreferencesResponse = await niceBackendFetch(
    "/api/v1/emails/notification-preference/me",
    {
      method: "GET",
      accessType: "client",
    }
  );
  expect(listPreferencesResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "can_disable": false,
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Transactional",
          },
          {
            "can_disable": true,
            "enabled": false,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Marketing",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
