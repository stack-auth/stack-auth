import { afterEach, describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, backendContext, createMailbox, niceBackendFetch, waitForOutboxEmailWithStatus } from "../../../../backend-helpers";

afterEach(() => {
  delete process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS;
});

describe("POST /api/v1/internal/feedback", () => {
  it("should reject unauthenticated requests", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      accessType: "client",
      body: {
        email: "test@example.com",
        message: "This should be rejected",
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
                - auth.user must be defined
            \`,
          },
          "error": deindent\`
            Request validation failed on POST /api/v1/internal/feedback:
              - auth.user must be defined
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "SCHEMA_ERROR",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("should send support feedback to the configured internal inbox", async ({ expect }) => {
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
        message: "Please replace Web3Forms with native email delivery.",
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
    expect(emails[0]?.to).toMatchObject({
      type: "custom-emails",
      emails: ["team@stack-auth.com"],
    });

    const messages = await recipientMailbox.waitForMessagesWithSubject(subject);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toBe(subject);
    expect(messages[0]?.body?.text).toContain("Support Tester");
    expect(messages[0]?.body?.text).toContain(senderEmail);
    expect(messages[0]?.body?.text).toContain(signInResult.userId);
    expect(messages[0]?.body?.text).toContain("Please replace Web3Forms with native email delivery.");
  });

  it("should reject invalid payloads", async ({ expect }) => {
    await Auth.Otp.signIn();

    const response = await niceBackendFetch("/api/v1/internal/feedback", {
      method: "POST",
      accessType: "client",
      body: {
        email: backendContext.value.mailbox.emailAddress,
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
