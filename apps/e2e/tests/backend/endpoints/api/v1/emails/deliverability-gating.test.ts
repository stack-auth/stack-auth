import { wait } from "@hexclave/shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { withPortPrefix } from "../../../../../helpers/ports";
import { Project, niceBackendFetch, waitForOutboxEmailWithStatus } from "../../../../backend-helpers";

// The Emailable wrapper always reports this exact domain as undeliverable, regardless of API key, so we can exercise
// the deliverability gate deterministically without hitting the real Emailable API.
const NOT_DELIVERABLE_EMAIL = "recipient@emailable-not-deliverable.example.com";

const customSmtpConfig = {
  type: "standard",
  host: "localhost",
  port: Number(withPortPrefix("29")),
  username: "test",
  password: "test",
  sender_name: "Test Project",
  sender_email: "test@example.com",
} as const;

async function sendToNotDeliverableAddress(subject: string) {
  return await niceBackendFetch("/api/v1/emails/send-email", {
    method: "POST",
    accessType: "server",
    body: {
      emails: [NOT_DELIVERABLE_EMAIL],
      html: "<p>Deliverability gating test</p>",
      subject,
    },
  });
}

// Sets up and applies a managed custom domain on the current project using the mock Resend onboarding flow.
async function applyManagedEmailDomain(options: { subdomain: string, senderLocalPart: string }) {
  const setupResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/setup", {
    method: "POST",
    accessType: "admin",
    body: {
      subdomain: options.subdomain,
      sender_local_part: options.senderLocalPart,
    },
  });
  if (setupResponse.status !== 200) {
    throw new Error(`Managed onboarding setup failed: ${JSON.stringify(setupResponse.body)}`);
  }
  const domainId = setupResponse.body.domain_id as string;

  // The mock onboarding flips the domain to "verified" asynchronously, mirroring the real Resend webhook.
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const checkResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/check", {
      method: "POST",
      accessType: "admin",
      body: {
        domain_id: domainId,
        subdomain: options.subdomain,
        sender_local_part: options.senderLocalPart,
      },
    });
    if (checkResponse.status === 200 && checkResponse.body.status === "verified") {
      break;
    }
    await wait(250);
  }

  const applyResponse = await niceBackendFetch("/api/v1/internal/emails/managed-onboarding/apply", {
    method: "POST",
    accessType: "admin",
    body: {
      domain_id: domainId,
    },
  });
  if (applyResponse.status !== 200 || applyResponse.body.status !== "applied") {
    throw new Error(`Managed onboarding apply failed: ${JSON.stringify(applyResponse.body)}`);
  }
}

describe("emailable deliverability gating", () => {
  it("runs the deliverability check on the shared email server (undeliverable address is skipped)", async ({ expect }) => {
    // A fresh project defaults to the shared email server.
    await Project.createAndSwitch({ display_name: "Shared Deliverability Project" });

    const subject = "Shared Deliverability Gating Test";
    const response = await sendToNotDeliverableAddress(subject);
    expect(response.status).toBe(200);

    const emails = await waitForOutboxEmailWithStatus(subject, "skipped");
    expect(emails[0].skipped_reason).toBe("LIKELY_NOT_DELIVERABLE");
  });

  it("runs the deliverability check on a managed custom domain (undeliverable address is skipped)", async ({ expect }) => {
    await Project.createAndSwitch({ display_name: "Managed Deliverability Project" });
    await applyManagedEmailDomain({ subdomain: "mail.example.com", senderLocalPart: "noreply" });

    const subject = "Managed Deliverability Gating Test";
    const response = await sendToNotDeliverableAddress(subject);
    expect(response.status).toBe(200);

    const emails = await waitForOutboxEmailWithStatus(subject, "skipped");
    expect(emails[0].skipped_reason).toBe("LIKELY_NOT_DELIVERABLE");
  });

  it("does NOT run the deliverability check on a custom SMTP server (undeliverable address is still sent)", async ({ expect }) => {
    // A custom SMTP server (and likewise a custom Resend API key) is the user's own infrastructure, so we leave
    // deliverability to them and never call Emailable. The email therefore proceeds to send instead of being skipped.
    await Project.createAndSwitch({
      display_name: "Custom SMTP Deliverability Project",
      config: {
        email_config: customSmtpConfig,
      },
    });

    const subject = "Custom SMTP Deliverability Gating Test";
    const response = await sendToNotDeliverableAddress(subject);
    expect(response.status).toBe(200);

    const emails = await waitForOutboxEmailWithStatus(subject, "sent");
    expect(emails[0].status).toBe("sent");
  });
});
