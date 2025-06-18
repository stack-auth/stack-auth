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

    const testEmailResponse = await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
      headers: {
        "x-stack-admin-access-token": adminAccessToken,
      },
      body: {
        "recipient_email": "test-email-recipient@stackframe.co",
        "email_config": {
          "host": "this-is-not-a-valid-host.example.com",
          "port": 123,
          "username": "123",
          "password": "123",
          "sender_email": "123@g.co",
          "sender_name": "123"
        }
      },
    });
    expect(testEmailResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "error_message": "Failed to connect to the email host. Please make sure the email host configuration is correct.",
          "success": false,
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);
    console.log(response.body);

    const failedEmailsByTenancy = response.body.failed_emails_by_tenancy;
    const mockProjectFailedEmails = failedEmailsByTenancy.filter(
      (batch: any) => batch.tenant_owner_email === backendContext.value.mailbox.emailAddress
    );
    expect(mockProjectFailedEmails).toMatchInlineSnapshot(`
      [
        {
          "emails": [
            {
              "subject": "Test Email from Stack Auth",
              "to": ["test-email-recipient@stackframe.co"],
            },
          ],
          "project_id": "<stripped UUID>",
          "tenancy_id": "<stripped UUID>",
          "tenant_owner_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
        },
      ]
    `);

    const messages = await backendContext.value.mailbox.fetchMessages();
    const digestEmail = messages.find(msg => msg.subject === "Failed emails digest");
    expect(digestEmail).toBeDefined();
    expect(digestEmail!.from).toBe("Stack Auth <noreply@example.com>");
  });

  it("should return 200 and not send digest email when all emails are successful", async ({ expect }) => {
    await Auth.Otp.signIn();
    const { projectId } = await Project.create({
      display_name: "Test Successful Emails Project",
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

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);

    const failedEmailsByTenancy = response.body.failed_emails_by_tenancy;
    const mockProjectFailedEmails = failedEmailsByTenancy.filter(
      (batch: any) => batch.tenant_owner_email === backendContext.value.mailbox.emailAddress
    );
    expect(mockProjectFailedEmails).toMatchInlineSnapshot(`[]`);

    const messages = await backendContext.value.mailbox.fetchMessages();
    const digestEmail = messages.find(msg => msg.subject === "Failed emails digest");
    expect(digestEmail).toBeUndefined();
  });
});
