import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, backendContext, InternalProjectKeys, niceBackendFetch, Project } from "../../../../backend-helpers";

describe("unauthorized requests", () => {
  it("should return 401 when invalid authorization is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/internal/failed-emails-digest",
      {
        method: "POST",
        accessType: "server",
        headers: {
          "Authorization": "Bearer some_invalid_secret",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": "Unauthorized",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("should return 400 when no authorization header is provided", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/internal/failed-emails-digest",
      {
        method: "POST",
        accessType: "server",
      }
    );
    expect(response.status).toBe(400);
  });

  it("should return 401 when authorization header is malformed", async ({ expect }) => {
    const response = await niceBackendFetch(
      "/api/v1/internal/failed-emails-digest",
      {
        method: "POST",
        accessType: "server",
        headers: {
          "Authorization": "InvalidFormat",
        }
      }
    );
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": "Unauthorized",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});

describe("with valid credentials", () => {
  it("should return 200 and process failed emails digest", async ({ expect }) => {
    backendContext.set({
      projectKeys: InternalProjectKeys,
      userAuth: null,
    });
    await Auth.Otp.signIn();
    const adminAccessToken = backendContext.value.userAuth?.accessToken;
    const { projectId } = await Project.create({
      display_name: "Test Failed Emails Project",
      config: {
        email_config: {
          type: "standard",
          host: "invalid-smtp-host.example.com",
          port: 587,
          username: "invalid_user",
          password: "invalid_password",
          sender_name: "Test Project",
          sender_email: "test@invalid-domain.example.com",
        },
      },
    });

    backendContext.set({
      projectKeys: {
        projectId,
      },
      userAuth: null,
    });

    await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
      headers: {
        "x-stack-admin-access-token": adminAccessToken,
      },
      body: {
        "recipient_email": "test-email-recipient@stackframe.co",
        "email_config": {
          "host": "123",
          "port": 123,
          "username": "123",
          "password": "123",
          "sender_email": "123@g.co",
          "sender_name": "123"
        }
      },
    });

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);

    const failedEmailsByTenancy = response.body.failed_emails_by_tenancy;
    const mockProjectFailedEmails = failedEmailsByTenancy.filter(
      (batch: any) => batch.tenant_owner_email === backendContext.value.mailbox.emailAddress
    );
    expect(mockProjectFailedEmails.length).toBe(1);
    expect(mockProjectFailedEmails[0].emails).toMatchInlineSnapshot(`
      [
        {
          "subject": "Test Email from Stack Auth",
          "to": ["test-email-recipient@stackframe.co"],
        },
      ]
    `);
  });
});
