import { StackServerApp } from "@hexclave/js";
import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { beforeAll, describe, expect } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

describe("Comms server SDK", () => {
  let serverApp: StackServerApp;

  beforeAll(async () => {
    ({ serverApp } = await createApp());
  }, 30_000);

  it("uses camelCase resources for contacts, messages, conversations, and deliveries", async () => {
    const contact = await serverApp.createContact({
      displayName: "Ada",
      contactChannels: [{
        type: "email",
        value: `ada-${generateSecureRandomString()}@example.com`,
        isPrimary: true,
      }],
    });
    expect(contact.displayName).toBe("Ada");
    expect(contact.contactChannels[0]?.isPrimary).toBe(true);

    await contact.update({ displayName: "Ada Lovelace" });
    const refreshedContact = await serverApp.getContact(contact.id);
    expect(refreshedContact.displayName).toBe("Ada Lovelace");

    const conversation = await serverApp.createCommsConversation({ title: "SDK conversation" });
    const message = await serverApp.createCommsMessage({
      direction: "inbound",
      adapterKey: "e2e:email",
      externalMessageId: generateSecureRandomString(),
      occurredAt: new Date(),
      conversationId: conversation.id,
      payload: {
        type: "email",
        version: 1,
        subject: "Hello",
        textBody: "Test",
        htmlBody: null,
        ampHtmlBody: null,
        headers: [],
      },
      participants: [{
        role: "from",
        contactId: contact.id,
        contactChannelId: contact.contactChannels[0]?.id,
        addressSnapshot: contact.contactChannels[0]?.value,
      }],
    });

    const allMessages = await serverApp.listCommsMessages({ limit: 200 });
    expect(allMessages.some((candidate) => candidate.id === message.id)).toBe(true);
    const conversationMessages = await conversation.listMessages();
    expect(conversationMessages.map((candidate) => candidate.id)).toContain(message.id);

    const delivery = await message.createDelivery({
      addressSnapshot: "recipient@example.com",
    });
    await delivery.updateStatus({ status: "sent", providerMessageId: "provider-message" });
    const attempt = await delivery.recordAttempt({
      outcome: "success",
      status: "delivered",
    });
    expect(attempt.attemptNumber).toBe(1);

    const refreshedDelivery = await serverApp.getCommsDelivery(delivery.id);
    expect(refreshedDelivery.status).toBe("delivered");
    expect(refreshedDelivery.providerMessageId).toBe("provider-message");
  });
});
