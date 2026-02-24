import { afterEach, describe, expect, it, vi } from "vitest";
import { setupManagedEmailProvider } from "./managed-email-onboarding";

function jsonResponse(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function setupCommonEnv() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("STACK_RESEND_API_KEY", "resend_test_key");
  vi.stubEnv("STACK_CLOUDFLARE_API_TOKEN", "cf_test_token");
  vi.stubEnv("STACK_CLOUDFLARE_ACCOUNT_ID", "cf_account_123");
  vi.stubEnv("STACK_CLOUDFLARE_API_BASE_URL", "https://api.cloudflare.test/client/v4");
}

describe("setupManagedEmailProvider with Cloudflare delegation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("creates resend records in an existing Cloudflare zone and returns Cloudflare nameservers", async () => {
    setupCommonEnv();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const responses: Response[] = [
      jsonResponse({
        id: "resend_domain_123",
        name: "mail.customer-example.com",
        records: [
          { record: "TXT", type: "TXT", name: "mail.customer-example.com", value: "v=spf1 include:amazonses.com ~all", status: "pending" },
          { record: "CNAME", type: "CNAME", name: "em.mail.customer-example.com", value: "u123.wl.sendgrid.net", status: "pending" },
          { record: "MX", type: "MX", name: "mail.customer-example.com", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, status: "pending" },
          { record: "NS", type: "NS", name: "mail.customer-example.com", value: "ignored.ns.example.com", status: "pending" },
        ],
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: [
          {
            id: "zone_123",
            name: "mail.customer-example.com",
            name_servers: ["alex.ns.cloudflare.com", "jamie.ns.cloudflare.com"],
          },
        ],
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: [],
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: {
          id: "record_txt_1",
          type: "TXT",
          name: "mail.customer-example.com",
          content: "v=spf1 include:amazonses.com ~all",
        },
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: {
          id: "record_cname_1",
          type: "CNAME",
          name: "em.mail.customer-example.com",
          content: "u123.wl.sendgrid.net",
        },
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: {
          id: "record_mx_1",
          type: "MX",
          name: "mail.customer-example.com",
          content: "feedback-smtp.us-east-1.amazonses.com",
          priority: 10,
        },
      }),
    ];

    fetchSpy.mockImplementation(async () => {
      const response = responses.shift();
      if (response == null) {
        throw new Error("Unexpected fetch call in managed-email-onboarding test");
      }
      return response;
    });

    const result = await setupManagedEmailProvider({
      subdomain: "mail.customer-example.com",
      senderLocalPart: "noreply",
      tenancyId: "tenancy_123",
    });

    expect(result).toEqual({
      domainId: "resend_domain_123",
      nameServerRecords: ["alex.ns.cloudflare.com", "jamie.ns.cloudflare.com"],
    });

    const createRecordCalls = fetchSpy.mock.calls
      .filter((call) => typeof call[0] === "string" && call[0].toString().includes("/dns_records") && call[1]?.method === "POST");
    expect(createRecordCalls).toHaveLength(3);
  });

  it("fails loudly when a CNAME would conflict with existing DNS records", async () => {
    setupCommonEnv();

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const responses: Response[] = [
      jsonResponse({
        id: "resend_domain_456",
        name: "mail.customer-two.com",
        records: [
          { record: "CNAME", type: "CNAME", name: "mail.customer-two.com", value: "u456.wl.sendgrid.net", status: "pending" },
        ],
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: [
          {
            id: "zone_456",
            name: "mail.customer-two.com",
            name_servers: ["alex.ns.cloudflare.com", "jamie.ns.cloudflare.com"],
          },
        ],
      }),
      jsonResponse({
        success: true,
        errors: [],
        result: [
          {
            id: "existing_txt",
            type: "TXT",
            name: "mail.customer-two.com",
            content: "v=spf1 include:amazonses.com ~all",
          },
        ],
      }),
    ];

    fetchSpy.mockImplementation(async () => {
      const response = responses.shift();
      if (response == null) {
        throw new Error("Unexpected fetch call in managed-email-onboarding conflict test");
      }
      return response;
    });

    await expect(setupManagedEmailProvider({
      subdomain: "mail.customer-two.com",
      senderLocalPart: "noreply",
      tenancyId: "tenancy_456",
    })).rejects.toThrowError("Cannot create Cloudflare DNS record because of CNAME conflict");
  });

  it("uses mock onboarding automatically in development when resend key is a mock key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STACK_RESEND_API_KEY", "mock_resend_api_key");

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await setupManagedEmailProvider({
      subdomain: "mail.customer-three.com",
      senderLocalPart: "noreply",
      tenancyId: "tenancy_789",
    });

    expect(result).toEqual({
      domainId: "managed_mock_tenancy_789_mail_customer-three_com",
      nameServerRecords: ["alex.ns.cloudflare.com", "jamie.ns.cloudflare.com"],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
