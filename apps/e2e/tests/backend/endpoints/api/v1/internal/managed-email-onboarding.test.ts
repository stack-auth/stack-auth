import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

describe("managed email onboarding internal endpoints", () => {
  it("rejects client access for setup endpoint", async ({ expect }) => {
    await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/setup", {
      method: "POST",
      accessType: "client",
      body: {
        subdomain: "mail.example.com",
        sender_local_part: "noreply",
      },
    });

    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": ["admin"],
          },
          "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("sets up and completes managed onboarding with admin access", async ({ expect }) => {
    await Project.createAndSwitch();

    const setupResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/setup", {
      method: "POST",
      accessType: "admin",
      body: {
        subdomain: "mail.example.com",
        sender_local_part: "noreply",
      },
    });

    expect(setupResponse.status).toBe(200);
    expect(setupResponse.body.domain_id).toBeDefined();
    expect(setupResponse.body.name_server_records).toMatchInlineSnapshot(`
      [
        "alex.ns.cloudflare.com",
        "jamie.ns.cloudflare.com",
      ]
    `);

    const checkResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/check", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: setupResponse.body.domain_id,
        subdomain: "mail.example.com",
        sender_local_part: "noreply",
      },
    });

    expect(checkResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "status": "complete" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const configResponse = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
    });
    const config = JSON.parse(configResponse.body.config_string);

    expect(config.emails.server).toMatchObject({
      isShared: false,
      provider: "managed",
      managedSubdomain: "mail.example.com",
      managedSenderLocalPart: "noreply",
      senderEmail: "noreply@mail.example.com",
    });
    expect(config.emails.server.password).toEqual(expect.stringMatching(/^managed_mock_key_/));
  });
});
