import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../helpers";
import { niceBackendFetch, Project, User } from "../../../backend-helpers";

describe("invalid requests", () => {
  it("should return 401 when invalid access type is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/emails",
      {
        method: "POST",
        accessType: "client",
        body: {
          user_id: randomUUID(),
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": [
              "server",
              "admin",
            ],
          },
          "error": "The x-stack-access-type header must be 'server' or 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should return 404 when user is not found", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/emails",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_id: randomUUID(),
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 404,
        "body": "User not found",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when user does not have a primary email", async ({ expect }) => {
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(createUserResponse.status).toBe(201);

    const response = await niceBackendFetch(
      "/api/v1/emails",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_id: createUserResponse.body.id,
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "User does not have a primary email",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when using shared email config", async ({ expect }) => {
    const createUserResponse = await niceBackendFetch("/api/v1/users", {
      method: "POST",
      accessType: "server",
      body: {
        primary_email: "test@example.com",
      },
    });
    const response = await niceBackendFetch(
      "/api/v1/emails",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_id: createUserResponse.body.id,
          html: "<p>Test email</p>",
          subject: "Test Subject",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": "Cannot send custom emails when using shared email config",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("with valid credentials", () => {
  it("should return 200 and send email successfully", async ({ expect }) => {
    await Project.createAndSwitch({
      display_name: "Test Successful Email Project",
      config: {
        email_config: {
          type: "standard",
          host: "localhost",
          port: 2500,
          username: "test",
          password: "test",
          sender_name: "Test Project",
          sender_email: "test@example.com",
        },
      },
    });
    const user = await User.create();
    const response = await niceBackendFetch(
      "/api/v1/emails",
      {
        method: "POST",
        accessType: "server",
        body: {
          user_id: user.userId,
          html: "<h1>Test Email</h1><p>This is a test email with HTML content.</p>",
          subject: "Custom Test Email Subject",
        }
      }
    );

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // Verify the email was actually sent by checking the mailbox
    const messages = await user.mailbox.fetchMessages();
    const sentEmail = messages.find(msg => msg.subject === "Custom Test Email Subject");
    expect(sentEmail).toBeDefined();
    expect(sentEmail!.body?.html).toContain("<h1>Test Email</h1>");
    expect(sentEmail!.body?.html).toContain("<p>This is a test email with HTML content.</p>");
  });
});
