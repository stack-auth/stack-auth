import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch, waitForOutboxEmailWithStatus } from "../../../../backend-helpers";

describe("POST /api/v1/internal/feedback", () => {
  it("should send feedback from an authenticated user", async ({ expect }) => {
    const senderEmail = backendContext.value.mailbox.emailAddress;
    const signInResult = await Auth.Otp.signIn();
    const recipientMailbox = createMailbox("team@stack-auth.com");
    const subject = `[Support] ${senderEmail}`;

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      accessType: "client",
      body: {
        name: "Support Tester",
        email: senderEmail,
        message: "Authenticated feedback from the dashboard.",
      },
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const emails = await waitForOutboxEmailWithStatus(subject, "sent");
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toMatchObject({
      type: "custom-emails",
      emails: ["team@stack-auth.com"],
    });

    const messages = await recipientMailbox.waitForMessagesWithSubject(subject);
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe(subject);
    expect(messages[0].body?.text).toContain("Support Tester");
    expect(messages[0].body?.text).toContain(senderEmail);
    expect(messages[0].body?.text).toContain(signInResult.userId);
    expect(messages[0].body?.text).toContain("Authenticated feedback from the dashboard.");
  });

  it("should send feedback without authentication (dev tool)", async ({ expect }) => {
    const recipientMailbox = createMailbox("team@stack-auth.com");
    const subject = "[Support] devtool-user@example.com";

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      body: {
        name: "Dev Tool User",
        email: "devtool-user@example.com",
        message: "Unauthenticated feedback from the dev tool.",
        feedback_type: "feedback",
      },
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const emails = await waitForOutboxEmailWithStatus(subject, "sent");
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toMatchObject({
      type: "custom-emails",
      emails: ["team@stack-auth.com"],
    });

    const messages = await recipientMailbox.waitForMessagesWithSubject(subject);
    expect(messages).toHaveLength(1);
    expect(messages[0].body?.text).toContain("Dev Tool User");
    expect(messages[0].body?.text).toContain("devtool-user@example.com");
    expect(messages[0].body?.text).toContain("Unauthenticated feedback from the dev tool.");
  });

  it("should send bug reports with correct label", async ({ expect }) => {
    const recipientMailbox = createMailbox("team@stack-auth.com");
    const subject = "[Bug Report] bug@example.com";

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      body: {
        email: "bug@example.com",
        message: "Something is broken.",
        feedback_type: "bug",
      },
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "success": true },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const emails = await waitForOutboxEmailWithStatus(subject, "sent");
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toMatchObject({
      type: "custom-emails",
      emails: ["team@stack-auth.com"],
    });

    const messages = await recipientMailbox.waitForMessagesWithSubject(subject);
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe("[Bug Report] bug@example.com");
  });

  it("should reject invalid payloads", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      body: {
        email: "test@example.com",
        message: "",
      },
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "SCHEMA_ERROR",
          "details": {
            "message": deindent\`
              Request validation failed on POST /api/v1/internal/feedback:
                - body.message must not be empty
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/internal/feedback:
              - body.message must not be empty
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});
