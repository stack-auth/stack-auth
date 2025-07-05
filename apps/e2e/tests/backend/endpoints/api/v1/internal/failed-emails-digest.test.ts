import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, backendContext, bumpEmailAddress, InternalProjectKeys, niceBackendFetch, Project, User } from "../../../../backend-helpers";

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
    await Project.createAndSwitch({
      display_name: "Test Failed Emails Project",
    }, true);

    const testEmailResponse = await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
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

    const failedEmailsByTenancy = response.body.failed_emails_by_tenancy;
    const mockProjectFailedEmails = failedEmailsByTenancy.filter(
      (batch: any) => batch.tenant_owner_emails.includes(backendContext.value.mailbox.emailAddress)
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
          "tenant_owner_emails": ["default-mailbox--<stripped UUID>@stack-generated.example.com"],
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
    await Project.create({
      display_name: "Test Successful Emails Project",
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

  it("should not send digest email when project owner has no primary email", async ({ expect }) => {
    backendContext.set({
      projectKeys: InternalProjectKeys,
      userAuth: null,
    });
    const { userId } = await Auth.Otp.signIn();

    // Remove primary email from the user
    const updateEmailResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        "primary_email": null,
      },
    });
    expect(updateEmailResponse.status).toBe(200);

    await Project.createAndSwitch({
      display_name: "Test Project No Owner Email",
    });

    // Send a test email that will fail
    await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
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

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);

    const messages = await backendContext.value.mailbox.fetchMessages();
    const digestEmail = messages.find(msg => msg.subject === "Failed emails digest");
    expect(digestEmail).toBeUndefined();
  });

  it("should not send digest email when project has no owner (account deleted)", async ({ expect }) => {
    const { userId } = await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Project Deleted Owner",
    }, true);

    // Send a test email that will fail
    await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
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

    // Delete the user account (project owner)
    backendContext.set({
      projectKeys: InternalProjectKeys,
    });
    const deleteUserResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteUserResponse.body).toMatchInlineSnapshot(`{ "success": true }`);

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);

    // Should not send digest email when project owner is deleted
    const messages = await backendContext.value.mailbox.fetchMessages();
    const digestEmail = messages.find(msg => msg.subject === "Failed emails digest");
    expect(digestEmail).toBeUndefined();
  });

  it("should not send digest email when project is deleted after email delivery failed", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Project To Be Deleted",
    }, true);

    // Send a test email that will fail
    await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
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

    // Delete the project
    const deleteProjectResponse = await niceBackendFetch(`/api/v1/internal/projects/current`, {
      method: "DELETE",
      accessType: "admin",
    });
    expect(deleteProjectResponse.body).toMatchInlineSnapshot(`{ "success": true }`);

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);

    // Should not send digest email when project is deleted
    const messages = await backendContext.value.mailbox.fetchMessages();
    const digestEmail = messages.find(msg => msg.subject === "Failed emails digest");
    expect(digestEmail).toBeUndefined();
  });

  it("should send digest email to each owner when project has multiple owners", async ({ expect }) => {
    const firstOwnerMailbox = backendContext.value.mailbox;
    backendContext.set({
      projectKeys: InternalProjectKeys,
    });
    await Auth.Otp.signIn();
    const { projectId } = await Project.createAndSwitch({
      display_name: "Test Project Multiple Owners",
    }, true);
    const oldProjectKeys = backendContext.value.projectKeys;
    const oldAuth = backendContext.value.userAuth;
    const secondOwnerMailbox = await bumpEmailAddress();
    backendContext.set({
      projectKeys: InternalProjectKeys,
    });
    const { userId } = await Auth.Otp.signIn();

    const updateUserResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
      method: "PATCH",
      accessType: "admin",
      body: {
        server_metadata: { managedProjectIds: [projectId] }
      },
    });
    expect(updateUserResponse.status).toBe(200);
    backendContext.set({ projectKeys: oldProjectKeys, userAuth: oldAuth });

    // Send a test email that will fail
    const sendTestEmailResponse = await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
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
    expect(sendTestEmailResponse.body).toMatchInlineSnapshot(`
      {
        "error_message": "Failed to connect to the email host. Please make sure the email host configuration is correct.",
        "success": false,
      }
    `);

    const response = await niceBackendFetch("/api/v1/internal/failed-emails-digest", {
      method: "POST",
      headers: { "Authorization": "Bearer mock_cron_secret" }
    });
    expect(response.status).toBe(200);
    const currentResponses = response.body.failed_emails_by_tenancy.filter(
      (batch: any) => batch.project_id === projectId
    );
    expect(currentResponses.length).toBe(1);
    expect(currentResponses[0].tenant_owner_emails.length).toBe(2);
    expect(currentResponses[0].tenant_owner_emails.includes(firstOwnerMailbox.emailAddress)).toBe(true);
    expect(currentResponses[0].tenant_owner_emails.includes(secondOwnerMailbox.emailAddress)).toBe(true);

    const firstMailboxMessages = await firstOwnerMailbox.fetchMessages();
    const secondMailboxMessages = await secondOwnerMailbox.fetchMessages();
    const firstMailboxDigestEmail = firstMailboxMessages.find(msg => msg.subject === "Failed emails digest");
    const secondMailboxDigestEmail = secondMailboxMessages.find(msg => msg.subject === "Failed emails digest");
    expect(firstMailboxDigestEmail).toBeDefined();
    expect(secondMailboxDigestEmail).toBeDefined();
  });
});
