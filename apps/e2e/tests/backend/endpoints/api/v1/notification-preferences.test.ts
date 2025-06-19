import { describe } from "vitest";
import { it } from "../../../../helpers";
import { Auth, niceBackendFetch } from "../../../backend-helpers";

describe("invalid requests", () => {
  it("should return 401 when invalid authorization is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/emails/notification-preference",
      {
        method: "POST",
        accessType: "client",
        body: {
          user_id: "me",
          notification_category_id: "marketing",
          enabled: true,
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
       "status": 401,
       "body": {
         "code": "USER_AUTHENTICATION_REQUIRED",
         "error": "User authentication required for this endpoint.",
       },
       "headers": Headers {
         "x-stack-known-error": "USER_AUTHENTICATION_REQUIRED",
         <some fields may have been hidden>,
       },
     }
    `);
  });

  it("should return 404 when invalid notification category id is provided", async ({ expect }) => {
    await Auth.Otp.signIn();
    const response = await niceBackendFetch(
      "/api/v1/emails/notification-preference",
      {
        method: "POST",
        accessType: "client",
        body: {
          user_id: "me",
          notification_category_id: "invalid-notification-category-id",
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
    "/api/v1/emails/notification-preference",
    {
      method: "GET",
      accessType: "client",
      query: {
        user_id: "me",
      }
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Transactional",
          },
          {
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
    "/api/v1/emails/notification-preference",
    {
      method: "POST",
      accessType: "client",
      body: {
        user_id: "me",
        notification_category_id: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
        enabled: false,
      }
    }
  );
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "enabled": false,
        "notification_category_id": "<stripped UUID>",
        "notification_category_name": "Marketing",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listPreferencesResponse = await niceBackendFetch(
    "/api/v1/emails/notification-preference",
    {
      method: "GET",
      accessType: "client",
      query: {
        user_id: "me",
      }
    }
  );
  expect(listPreferencesResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "enabled": true,
            "notification_category_id": "<stripped UUID>",
            "notification_category_name": "Transactional",
          },
          {
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
