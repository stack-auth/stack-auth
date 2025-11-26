import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { withPortPrefix } from "../../../../../helpers/ports";
import { Auth, niceBackendFetch, Project, User } from "../../../../backend-helpers";

describe("with valid credentials", () => {
  it("should return zero stats for a new project", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Stats Project",
    }, true);

    const response = await niceBackendFetch("/api/v1/emails/delivery-info", {
      method: "GET",
      accessType: "server",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "capacity": {
          "penalty_factor": 1,
          "rate_per_second": 1.3333333333333333,
        },
        "stats": {
          "day": {
            "bounced": 0,
            "marked_as_spam": 0,
            "sent": 0,
          },
          "hour": {
            "bounced": 0,
            "marked_as_spam": 0,
            "sent": 0,
          },
          "month": {
            "bounced": 0,
            "marked_as_spam": 0,
            "sent": 0,
          },
          "week": {
            "bounced": 0,
            "marked_as_spam": 0,
            "sent": 0,
          },
        },
      }
    `);
  });

  it("should track sent emails", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Sent Stats Project",
      config: {
        email_config: {
          type: "standard",
          host: "localhost",
          port: Number(withPortPrefix("29")),
          username: "test",
          password: "test",
          sender_name: "Test Project",
          sender_email: "test@example.com",
        },
      },
    }, true);
    const { userId } = await User.create({
      primary_email: "test-stats@example.com",
      primary_email_verified: true,
    });

    // Send an email
    const sendEmailResponse = await niceBackendFetch("/api/v1/emails/send-email", {
      method: "POST",
      accessType: "server",
      body: {
        user_ids: [userId],
        html: "Test email",
        subject: "Test",
      },
    });
    expect(sendEmailResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "results": [{ "user_id": "<stripped UUID>" }] },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    // wait for the email to be processed
    await wait(5_000);

    const response = await niceBackendFetch("/api/v1/emails/delivery-info", {
      method: "GET",
      accessType: "server",
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "capacity": {
            "penalty_factor": 1,
            "rate_per_second": 1.561904761904762,
          },
          "stats": {
            "day": {
              "bounced": 0,
              "marked_as_spam": 0,
              "sent": 1,
            },
            "hour": {
              "bounced": 0,
              "marked_as_spam": 0,
              "sent": 1,
            },
            "month": {
              "bounced": 0,
              "marked_as_spam": 0,
              "sent": 1,
            },
            "week": {
              "bounced": 0,
              "marked_as_spam": 0,
              "sent": 1,
            },
          },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });
});
