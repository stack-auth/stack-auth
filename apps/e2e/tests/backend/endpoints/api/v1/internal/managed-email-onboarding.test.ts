import { wait } from "@hexclave/shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../backend-helpers";

async function waitForManagedDomainStatus(options: {
  domainId: string,
  subdomain: string,
  senderLocalPart: string,
  status: string,
}) {
  const deadline = performance.now() + 10_000;
  let lastBody: unknown = undefined;
  while (performance.now() < deadline) {
    const response = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/check", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: options.domainId,
        subdomain: options.subdomain,
        sender_local_part: options.senderLocalPart,
      },
    });
    lastBody = response.body;
    if (response.status === 200 && response.body.status === options.status) {
      return;
    }
    await wait(250);
  }

  throw new Error(`Timed out waiting for managed email domain ${options.domainId} to become ${options.status}; last response body: ${JSON.stringify(lastBody)}`);
}

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
          "error": "The x-hexclave-access-type header must be 'admin', but was 'client'. (The legacy x-stack-access-type header is also accepted.)",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("sets up managed onboarding, exposes status, and applies only with explicit action", async ({ expect }) => {
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
    expect(setupResponse.body.status).toBe("pending_verification");

    // Mock onboarding asynchronously flips status to "verified" after setup,
    // mirroring the real Resend webhook flow.
    await waitForManagedDomainStatus({
      domainId: setupResponse.body.domain_id,
      subdomain: "mail.example.com",
      senderLocalPart: "noreply",
      status: "verified",
    });

    const listResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/list", {
      method: "GET",
      accessType: "admin",
    });

    expect(listResponse.body.items).toHaveLength(1);
    expect(listResponse.body.items[0]).toMatchObject({
      domain_id: setupResponse.body.domain_id,
      subdomain: "mail.example.com",
      sender_local_part: "noreply",
      status: "verified",
      name_server_records: ["ns1.dnsimple.com", "ns2.dnsimple.com"],
    });

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
        "body": { "status": "verified" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const configBeforeApply = await niceBackendFetch("/api/v1/internal/config", {
      method: "GET",
      accessType: "admin",
    });
    const configBefore = JSON.parse(configBeforeApply.body.config_string);
    expect(configBefore.emails.server.provider).not.toBe("managed");

    const applyResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/apply", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: setupResponse.body.domain_id,
      },
    });
    expect(applyResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "status": "applied" },
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

  it("rejects client access for delete endpoint", async ({ expect }) => {
    await Project.createAndSwitch();

    const response = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/delete", {
      method: "POST",
      accessType: "client",
      body: {
        resend_domain_id: "managed_mock_domain",
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
          "error": "The x-hexclave-access-type header must be 'admin', but was 'client'. (The legacy x-stack-access-type header is also accepted.)",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });

  it("deletes a managed domain that is not in use", async ({ expect }) => {
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

    const deleteResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/delete", {
      method: "POST",
      accessType: "admin",
      body: {
        resend_domain_id: setupResponse.body.domain_id,
      },
    });
    expect(deleteResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "status": "deleted" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);

    const listResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/list", {
      method: "GET",
      accessType: "admin",
    });
    expect(listResponse.body.items).toHaveLength(0);
  });

  it("rejects deleting a managed domain that is in use", async ({ expect }) => {
    await Project.createAndSwitch();

    const setupResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/setup", {
      method: "POST",
      accessType: "admin",
      body: {
        subdomain: "mail.example.com",
        sender_local_part: "noreply",
      },
    });
    await waitForManagedDomainStatus({
      domainId: setupResponse.body.domain_id,
      subdomain: "mail.example.com",
      senderLocalPart: "noreply",
      status: "verified",
    });

    const applyResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/apply", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: setupResponse.body.domain_id,
      },
    });
    expect(applyResponse.status).toBe(200);

    const deleteResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/delete", {
      method: "POST",
      accessType: "admin",
      body: {
        resend_domain_id: setupResponse.body.domain_id,
      },
    });
    expect(deleteResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 409,
        "body": "Cannot delete a managed domain that is currently in use for sending email",
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("allows deleting a managed domain after switching away from managed email", async ({ expect }) => {
    await Project.createAndSwitch();

    const setupResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/setup", {
      method: "POST",
      accessType: "admin",
      body: {
        subdomain: "mail.example.com",
        sender_local_part: "noreply",
      },
    });
    await waitForManagedDomainStatus({
      domainId: setupResponse.body.domain_id,
      subdomain: "mail.example.com",
      senderLocalPart: "noreply",
      status: "verified",
    });

    const applyResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/apply", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: setupResponse.body.domain_id,
      },
    });
    expect(applyResponse.status).toBe(200);

    await Project.updateConfig({
      emails: {
        server: {
          isShared: false,
          provider: "resend",
          host: "smtp.resend.com",
          port: 465,
          username: "resend",
          password: "re_test_key",
          senderEmail: "noreply@mail.example.com",
          senderName: "Example",
          managedSubdomain: undefined,
          managedSenderLocalPart: undefined,
        },
      },
    });

    const deleteResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/delete", {
      method: "POST",
      accessType: "admin",
      body: {
        resend_domain_id: setupResponse.body.domain_id,
      },
    });
    expect(deleteResponse).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": { "status": "deleted" },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
  });

  it("returns 404 when deleting an unknown managed domain", async ({ expect }) => {
    await Project.createAndSwitch();

    const deleteResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/delete", {
      method: "POST",
      accessType: "admin",
      body: {
        resend_domain_id: "does-not-exist",
      },
    });
    expect(deleteResponse.status).toBe(404);
  });
});
