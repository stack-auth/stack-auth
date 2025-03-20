import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";

// Test the internal emails CRUD endpoint for listing sent emails
it("should list sent emails for the current project", async ({ expect }) => {
  // Sign in and create a project
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  await Auth.Otp.signIn();
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/emails", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  // Expect a successful response with the correct structure
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "error": null,
            "id": "<stripped UUID>",
            "sender_config": {
              "host": "127.0.0.1",
              "port": 2500,
              "sender_email": "noreply@example.com",
              "sender_name": "New Project",
              "type": "shared",
              "username": "does not matter, ignored by Inbucket",
            },
            "sent_at_millis": <stripped field 'sent_at_millis'>,
            "subject": "Sign in to New Project: Your code is <stripped code>",
            "to": ["default-mailbox--<stripped UUID>@stack-generated.example.com"],
          },
          {
            "error": null,
            "id": "<stripped UUID>",
            "sender_config": {
              "host": "127.0.0.1",
              "port": 2500,
              "sender_email": "noreply@example.com",
              "sender_name": "New Project",
              "type": "shared",
              "username": "does not matter, ignored by Inbucket",
            },
            "sent_at_millis": <stripped field 'sent_at_millis'>,
            "subject": "Sign in to New Project: Your code is <stripped code>",
            "to": ["default-mailbox--<stripped UUID>@stack-generated.example.com"],
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("should not allow two different projects to see the same send log", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  // Fetch the sent emails list
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/emails", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken,
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": false,
        "items": [
          {
            "error": null,
            "id": "<stripped UUID>",
            "sender_config": {
              "host": "127.0.0.1",
              "port": 2500,
              "sender_email": "noreply@example.com",
              "sender_name": "New Project",
              "type": "shared",
              "username": "does not matter, ignored by Inbucket",
            },
            "sent_at_millis": <stripped field 'sent_at_millis'>,
            "subject": "Sign in to New Project: Your code is <stripped code>",
            "to": ["default-mailbox--<stripped UUID>@stack-generated.example.com"],
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  await Project.resetContext();

  const { adminAccessToken: adminAccessToken2 } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  const response2 = await niceBackendFetch("/api/v1/internal/emails", {
    method: "GET",
    accessType: "admin",
    headers: {
      'x-stack-admin-access-token': adminAccessToken2,
    },
  });

  expect(response2).toMatchInlineSnapshot(`
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

it("should not allow a non-admin user to access the endpoint", async ({ expect }) => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  await Auth.Otp.signIn();
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/internal/emails", {
    method: "GET",
    accessType: "server",
  });

  // Expect a successful response with the correct structure
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});
