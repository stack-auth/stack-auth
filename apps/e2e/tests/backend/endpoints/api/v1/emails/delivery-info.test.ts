import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { withPortPrefix } from "../../../../../helpers/ports";
import { Auth, niceBackendFetch, Project, User } from "../../../../backend-helpers";

describe("capacity-boost", () => {
  it("should activate capacity boost and increase rate", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Boost Project",
    }, true);

    // Check initial state - no boost active
    const beforeResponse = await niceBackendFetch("/api/v1/emails/delivery-info", {
      method: "GET",
      accessType: "server",
    });
    expect(beforeResponse.status).toBe(200);
    expect(beforeResponse.body.capacity.is_boost_active).toBe(false);
    expect(beforeResponse.body.capacity.boost_expires_at).toBe(null);
    const baseRate = beforeResponse.body.capacity.rate_per_second;

    // Activate boost
    const boostResponse = await niceBackendFetch("/api/v1/emails/capacity-boost", {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(boostResponse.status).toBe(200);
    expect(boostResponse.body.expires_at).toBeDefined();

    // Verify boost is active and rate is 4x
    const afterResponse = await niceBackendFetch("/api/v1/emails/delivery-info", {
      method: "GET",
      accessType: "server",
    });
    expect(afterResponse.status).toBe(200);
    expect(afterResponse.body.capacity.is_boost_active).toBe(true);
    expect(afterResponse.body.capacity.boost_expires_at).toBeDefined();
    expect(afterResponse.body.capacity.rate_per_second).toBe(baseRate * 4);
  });

  it("should reject double activation while boost is active", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Double Boost Project",
    }, true);

    // First activation should succeed
    const firstResponse = await niceBackendFetch("/api/v1/emails/capacity-boost", {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(firstResponse.status).toBe(200);

    // Second activation while boost is active should fail
    const secondResponse = await niceBackendFetch("/api/v1/emails/capacity-boost", {
      method: "POST",
      accessType: "server",
      body: {},
    });
    expect(secondResponse.status).toBe(409);
    expect(secondResponse.body.code).toBe("EMAIL_CAPACITY_BOOST_ALREADY_ACTIVE");
  });

  it("should require server access type", async ({ expect }) => {
    await Auth.Otp.signIn();
    await Project.createAndSwitch({
      display_name: "Test Auth Project",
    }, true);

    const response = await niceBackendFetch("/api/v1/emails/capacity-boost", {
      method: "POST",
      accessType: "client",
      body: {},
    });
    expect(response.status).toBe(401);
  });
});

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
          "boost_expires_at": null,
          "boost_multiplier": 1,
          "is_boost_active": false,
          "penalty_factor": 1,
          "rate_per_second": 2.7777777777777777,
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
            "boost_expires_at": null,
            "boost_multiplier": 1,
            "is_boost_active": false,
            "penalty_factor": 1,
            "rate_per_second": 2.7777793209876545,
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
