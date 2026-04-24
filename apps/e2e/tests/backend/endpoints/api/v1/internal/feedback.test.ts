import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch, waitForOutboxEmailWithStatus } from "../../../../backend-helpers";

const isLocalEmulator = process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === "true";

describe("POST /api/v1/internal/feedback", () => {
  it.runIf(!isLocalEmulator)("should send feedback from an authenticated user", async ({ expect }) => {
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

    const listResponse = await niceBackendFetch("/api/v1/conversations", {
      accessType: "client",
    });
    expect(listResponse.status).toBe(200);
    const fromSupportForm = listResponse.body.conversations.find(
      (c: { subject: string }) => c.subject === subject,
    );
    expect(fromSupportForm).toBeDefined();
    expect(fromSupportForm.source).toBe("api");
    expect(fromSupportForm.preview).toContain("Authenticated feedback from the dashboard.");
  });

  it.runIf(!isLocalEmulator)("should send feedback without authentication (dev tool)", async ({ expect }) => {
    const recipientMailbox = createMailbox("team@stack-auth.com");
    const senderEmail = `devtool-user-${randomUUID()}@example.com`;
    const subject = `[Support] ${senderEmail}`;

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      body: {
        name: "Dev Tool User",
        email: senderEmail,
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
    expect(messages[0].body?.text).toContain(senderEmail);
    expect(messages[0].body?.text).toContain("Unauthenticated feedback from the dev tool.");
  });

  it.runIf(!isLocalEmulator)("should send bug reports with correct label", async ({ expect }) => {
    const recipientMailbox = createMailbox("team@stack-auth.com");
    const reporterEmail = `bug-${randomUUID()}@example.com`;
    const subject = `[Bug Report] ${reporterEmail}`;

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      body: {
        email: reporterEmail,
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
    expect(messages[0].subject).toBe(subject);
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
