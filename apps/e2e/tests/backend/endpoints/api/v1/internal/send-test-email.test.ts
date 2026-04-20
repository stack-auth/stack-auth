import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Project, niceBackendFetch, withInternalProject } from "../../../../backend-helpers";

const dummyEmailConfig = {
  host: "nonexistent.example.invalid",
  port: 587,
  username: "u",
  password: "p",
  sender_email: "s@example.com",
  sender_name: "S",
};

async function getEmailItemQuantity(ownerTeamId: string): Promise<number> {
  return await withInternalProject(async () => {
    const response = await niceBackendFetch(`/api/v1/payments/items/team/${ownerTeamId}/emails_per_month`, {
      accessType: "server",
    });
    if (response.status !== 200) {
      throw new Error(`Failed to get emails_per_month item: ${JSON.stringify(response.body)}`);
    }
    return (response.body as { quantity: number }).quantity;
  });
}

async function setEmailItemQuantity(ownerTeamId: string, quantity: number) {
  const currentQuantity = await getEmailItemQuantity(ownerTeamId);
  const delta = quantity - currentQuantity;
  await withInternalProject(async () => {
    const response = await niceBackendFetch(`/api/v1/payments/items/team/${ownerTeamId}/emails_per_month/update-quantity?allow_negative=true`, {
      method: "POST",
      accessType: "server",
      body: { delta },
    });
    if (response.status !== 200) {
      throw new Error(`Failed to set emails_per_month quantity: ${JSON.stringify(response.body)}`);
    }
  });
}

describe("POST /api/v1/internal/send-test-email — emails_per_month quota", () => {
  it("rejects with ITEM_QUANTITY_INSUFFICIENT_AMOUNT when quota is exhausted", async ({ expect }) => {
    const { createProjectResponse } = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
    const ownerTeamId = createProjectResponse.body.owner_team_id;

    await setEmailItemQuantity(ownerTeamId, 0);

    const response = await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
      body: {
        recipient_email: "test@example.com",
        email_config: dummyEmailConfig,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("ITEM_QUANTITY_INSUFFICIENT_AMOUNT");
  });

  it("debits emails_per_month by 1 even when SMTP fails", async ({ expect }) => {
    const { createProjectResponse } = await Project.createAndSwitch({ config: { magic_link_enabled: true } });
    const ownerTeamId = createProjectResponse.body.owner_team_id;

    const before = await getEmailItemQuantity(ownerTeamId);

    // SMTP call fails against nonexistent.example.invalid, but the quota debit
    // happens before SMTP so the decrement should be observable regardless.
    await niceBackendFetch("/api/v1/internal/send-test-email", {
      method: "POST",
      accessType: "admin",
      body: {
        recipient_email: "test@example.com",
        email_config: dummyEmailConfig,
      },
    });

    const after = await getEmailItemQuantity(ownerTeamId);
    expect(after).toBe(before - 1);
  });
});
