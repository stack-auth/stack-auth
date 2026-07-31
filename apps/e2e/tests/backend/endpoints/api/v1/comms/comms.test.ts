import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { it } from "../../../../../helpers";
import { Project, createMailbox, niceBackendFetch } from "../../../../backend-helpers";

function emailIngestBody(options: {
  externalMessageId: string,
  fromAddress: string,
  subject?: string,
  textBody?: string,
  conversationId?: string,
}) {
  return {
    direction: "inbound" as const,
    adapter_key: "email:test",
    external_message_id: options.externalMessageId,
    occurred_at_millis: Date.now(),
    payload: {
      type: "email" as const,
      version: 1 as const,
      subject: options.subject ?? "Hi",
      text_body: options.textBody ?? "hello",
      html_body: null,
      amp_html_body: null,
      headers: [],
    },
    participants: [
      {
        role: "from" as const,
        position: 0,
        address_snapshot: options.fromAddress,
        display_name_snapshot: null,
      },
    ],
    ...(options.conversationId != null ? { conversation_id: options.conversationId } : {}),
  };
}

it("ingests an email message with participants", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const externalMessageId = `msg-${generateSecureRandomString()}`;

  const response = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId,
      fromAddress: mailbox.emailAddress,
      subject: "Inbound hello",
      textBody: "hello world",
    }),
  });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "adapter_key": "email:test",
        "attachments": [],
        "conversation_id": "<stripped UUID>",
        "direction": "inbound",
        "external_message_id": "<stripped string>",
        "external_thread_id": null,
        "id": "<stripped UUID>",
        "ingested_at_millis": <stripped field 'ingested_at_millis'>,
        "occurred_at_millis": <stripped field 'occurred_at_millis'>,
        "participants": [
          {
            "address_snapshot": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "contact_channel_id": "<stripped UUID>",
            "contact_id": "<stripped UUID>",
            "display_name_snapshot": null,
            "id": "<stripped UUID>",
            "position": 0,
            "role": "from",
          },
        ],
        "payload": {
          "amp_html_body": null,
          "headers": [],
          "html_body": null,
          "subject": "Inbound hello",
          "text_body": "hello world",
          "type": "email",
          "version": 1,
        },
        "raw_blob_key": null,
        "relations": [],
        "reply_to_message_id": null,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("ingests a message idempotently with the same adapter_key and external_message_id", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const externalMessageId = `msg-${generateSecureRandomString()}`;
  const body = emailIngestBody({
    externalMessageId,
    fromAddress: mailbox.emailAddress,
  });

  const firstResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body,
  });
  expect(firstResponse.status).toBe(201);
  const messageId = firstResponse.body.id;

  const secondResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body,
  });
  expect(secondResponse.status).toBe(201);
  expect(secondResponse.body.id).toBe(messageId);
});

it("rejects a conflicting replay for the same external message identity", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const externalMessageId = `msg-${generateSecureRandomString()}`;
  const body = emailIngestBody({
    externalMessageId,
    fromAddress: mailbox.emailAddress,
    subject: "Original",
  });

  const firstResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body,
  });
  expect(firstResponse.status).toBe(201);

  const conflictingResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: {
      ...body,
      payload: {
        ...body.payload,
        subject: "Conflicting replay",
      },
    },
  });
  expect(conflictingResponse.status).toBe(409);
});

it("rejects unknown nested message payload fields", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const body = emailIngestBody({
    externalMessageId: `msg-${generateSecureRandomString()}`,
    fromAddress: mailbox.emailAddress,
  });

  const response = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: {
      ...body,
      payload: {
        ...body.payload,
        unexpected_field: "must not be silently ignored",
      },
    },
  });
  expect(response.status).toBe(400);
});

it("rejects invalid message graph inputs with client errors", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const base = emailIngestBody({
    externalMessageId: `msg-${generateSecureRandomString()}`,
    fromAddress: mailbox.emailAddress,
  });
  const conversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: {},
  });
  expect(conversationResponse.status).toBe(201);

  const invalidBodies = [
    { ...base, external_message_id: `empty-${generateSecureRandomString()}`, participants: [] },
    {
      ...base,
      external_message_id: `duplicate-${generateSecureRandomString()}`,
      participants: [...base.participants, ...base.participants],
    },
    {
      ...base,
      external_message_id: `reply-${generateSecureRandomString()}`,
      conversation_id: conversationResponse.body.id,
      reply_to_message_id: generateUuid(),
    },
    {
      ...base,
      external_message_id: `relation-${generateSecureRandomString()}`,
      relations: [{ relation_type: "references", to_message_id: generateUuid() }],
    },
    {
      ...base,
      external_message_id: `empty-relation-${generateSecureRandomString()}`,
      relations: [{ relation_type: "other" }],
    },
    {
      ...base,
      external_message_id: `attachment-${generateSecureRandomString()}`,
      attachments: [{ size_bytes: -1 }],
    },
  ];

  for (const body of invalidBodies) {
    const response = await niceBackendFetch("/api/v1/comms/messages", {
      accessType: "server",
      method: "POST",
      body,
    });
    expect(response.status).toBe(400);
  }
});

it("creates and lists conversations", async ({ expect }) => {
  await Project.createAndSwitch();

  const createResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: {
      title: "Support thread",
    },
  });
  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "created_at_millis": <stripped field 'created_at_millis'>,
        "first_message_at_millis": null,
        "id": "<stripped UUID>",
        "last_message_at_millis": null,
        "merged_at_millis": null,
        "merged_into_conversation_id": null,
        "title": "Support thread",
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
  });
  expect(listResponse.status).toBe(200);
  expect(listResponse.body.items.some((item: { id: string }) => item.id === createResponse.body.id)).toBe(true);
});

it("paginates conversations by last message time and id", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const conversationIds: string[] = [];

  const emptyConversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "Empty conversation" },
  });
  conversationIds.push(emptyConversationResponse.body.id);

  for (let index = 0; index < 4; index++) {
    const conversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
      accessType: "server",
      method: "POST",
      body: { title: `Page ${index}` },
    });
    conversationIds.push(conversationResponse.body.id);
    const ingestResponse = await niceBackendFetch("/api/v1/comms/messages", {
      accessType: "server",
      method: "POST",
      body: {
        ...emailIngestBody({
          externalMessageId: `page-${index}-${generateSecureRandomString()}`,
          fromAddress: mailbox.emailAddress,
          conversationId: conversationResponse.body.id,
        }),
        occurred_at_millis: 1_700_000_000_000 + index,
      },
    });
    expect(ingestResponse.status).toBe(201);
  }

  const paginatedIds: string[] = [];
  let cursor: string | null = null;
  do {
    const cursorQuery = cursor == null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await niceBackendFetch(`/api/v1/comms/conversations?limit=1${cursorQuery}`, {
      accessType: "server",
    });
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(1);
    paginatedIds.push(page.body.items[0].id);
    cursor = page.body.pagination.next_cursor;
  } while (cursor != null);

  expect(new Set(paginatedIds)).toEqual(new Set(conversationIds));
  expect(paginatedIds).toHaveLength(conversationIds.length);
});

it("lists messages for a conversation", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const conversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: {},
  });
  const conversationId = conversationResponse.body.id;

  const ingestResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
      conversationId,
    }),
  });
  expect(ingestResponse.status).toBe(201);

  const listResponse = await niceBackendFetch(`/api/v1/comms/conversations/${conversationId}/messages`, {
    accessType: "server",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "is_paginated": true,
        "items": [
          {
            "adapter_key": "email:test",
            "attachments": [],
            "conversation_id": "<stripped UUID>",
            "direction": "inbound",
            "external_message_id": "<stripped string>",
            "external_thread_id": null,
            "id": "<stripped UUID>",
            "ingested_at_millis": <stripped field 'ingested_at_millis'>,
            "occurred_at_millis": <stripped field 'occurred_at_millis'>,
            "participants": [
              {
                "address_snapshot": "mailbox-1--<stripped UUID>@stack-generated.example.com",
                "contact_channel_id": "<stripped UUID>",
                "contact_id": "<stripped UUID>",
                "display_name_snapshot": null,
                "id": "<stripped UUID>",
                "position": 0,
                "role": "from",
              },
            ],
            "payload": {
              "amp_html_body": null,
              "headers": [],
              "html_body": null,
              "subject": "Hi",
              "text_body": "hello",
              "type": "email",
              "version": 1,
            },
            "raw_blob_key": null,
            "relations": [],
            "reply_to_message_id": null,
          },
        ],
        "pagination": { "next_cursor": null },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const allMessagesResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
  });
  expect(allMessagesResponse.status).toBe(200);
  expect(allMessagesResponse.body.items.map((item: { id: string }) => item.id)).toContain(ingestResponse.body.id);
});

it("merges conversations with idempotency_key", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const idempotencyKey = `merge-conv-${generateSecureRandomString()}`;

  const sourceConversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "Source" },
  });
  const targetConversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "Target" },
  });
  const sourceConversationId = sourceConversationResponse.body.id;
  const targetConversationId = targetConversationResponse.body.id;

  await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
      conversationId: sourceConversationId,
    }),
  });

  const mergeResponse = await niceBackendFetch(`/api/v1/comms/conversations/${sourceConversationId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_conversation_id: targetConversationId,
      idempotency_key: idempotencyKey,
    },
  });
  expect(mergeResponse.status).toBe(200);
  expect(mergeResponse.body.replayed).toBe(false);
  expect(mergeResponse.body.conversation.id).toBe(targetConversationId);
  const operationId = mergeResponse.body.operation_id;

  const retryMergeResponse = await niceBackendFetch(`/api/v1/comms/conversations/${sourceConversationId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_conversation_id: targetConversationId,
      idempotency_key: idempotencyKey,
    },
  });
  expect(retryMergeResponse.status).toBe(200);
  expect(retryMergeResponse.body.replayed).toBe(true);
  expect(retryMergeResponse.body.operation_id).toBe(operationId);

  const changedRequestResponse = await niceBackendFetch(`/api/v1/comms/conversations/${sourceConversationId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_conversation_id: targetConversationId,
      idempotency_key: idempotencyKey,
      reason: "A materially different request",
    },
  });
  expect(changedRequestResponse.status).toBe(409);
});

it("splits a conversation", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const conversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "Combined" },
  });
  const conversationId = conversationResponse.body.id;

  const firstMessageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
      conversationId,
      subject: "First",
    }),
  });
  const secondMessageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
      conversationId,
      subject: "Second",
    }),
  });

  const splitResponse = await niceBackendFetch(`/api/v1/comms/conversations/${conversationId}/split`, {
    accessType: "server",
    method: "POST",
    body: {
      message_ids: [secondMessageResponse.body.id],
      idempotency_key: `split-${generateSecureRandomString()}`,
      title: "Split off",
    },
  });
  expect(splitResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversation": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "first_message_at_millis": <stripped field 'first_message_at_millis'>,
          "id": "<stripped UUID>",
          "last_message_at_millis": <stripped field 'last_message_at_millis'>,
          "merged_at_millis": null,
          "merged_into_conversation_id": null,
          "title": "Split off",
          "updated_at_millis": <stripped field 'updated_at_millis'>,
        },
        "operation_id": "<stripped UUID>",
        "replayed": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const originalListResponse = await niceBackendFetch(`/api/v1/comms/conversations/${conversationId}/messages`, {
    accessType: "server",
  });
  expect(originalListResponse.body.items.map((item: { id: string }) => item.id)).toEqual([firstMessageResponse.body.id]);

  const splitConversationId = splitResponse.body.conversation.id;
  const splitListResponse = await niceBackendFetch(`/api/v1/comms/conversations/${splitConversationId}/messages`, {
    accessType: "server",
  });
  expect(splitListResponse.body.items.map((item: { id: string }) => item.id)).toEqual([secondMessageResponse.body.id]);
});

it("reassigns messages to another conversation", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const sourceConversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "From" },
  });
  const targetConversationResponse = await niceBackendFetch("/api/v1/comms/conversations", {
    accessType: "server",
    method: "POST",
    body: { title: "To" },
  });
  const sourceConversationId = sourceConversationResponse.body.id;
  const targetConversationId = targetConversationResponse.body.id;

  const messageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
      conversationId: sourceConversationId,
    }),
  });

  const reassignResponse = await niceBackendFetch("/api/v1/comms/messages/reassign", {
    accessType: "server",
    method: "POST",
    body: {
      target_conversation_id: targetConversationId,
      message_ids: [messageResponse.body.id],
      idempotency_key: `reassign-${generateSecureRandomString()}`,
    },
  });
  expect(reassignResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversation": {
          "created_at_millis": <stripped field 'created_at_millis'>,
          "first_message_at_millis": <stripped field 'first_message_at_millis'>,
          "id": "<stripped UUID>",
          "last_message_at_millis": <stripped field 'last_message_at_millis'>,
          "merged_at_millis": null,
          "merged_into_conversation_id": null,
          "title": "To",
          "updated_at_millis": <stripped field 'updated_at_millis'>,
        },
        "operation_id": "<stripped UUID>",
        "replayed": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  expect(reassignResponse.body.conversation.id).toBe(targetConversationId);

  const targetListResponse = await niceBackendFetch(`/api/v1/comms/conversations/${targetConversationId}/messages`, {
    accessType: "server",
  });
  expect(targetListResponse.body.items.map((item: { id: string }) => item.id)).toEqual([messageResponse.body.id]);
});

it("creates a delivery, updates status, and records an attempt", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const messageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: {
      ...emailIngestBody({
        externalMessageId: `msg-${generateSecureRandomString()}`,
        fromAddress: mailbox.emailAddress,
      }),
      direction: "outbound",
    },
  });
  const messageId = messageResponse.body.id;

  const createDeliveryResponse = await niceBackendFetch(`/api/v1/comms/messages/${messageId}/deliveries`, {
    accessType: "server",
    method: "POST",
    body: {
      address_snapshot: mailbox.emailAddress,
      status: "pending",
    },
  });
  expect(createDeliveryResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "address_snapshot": "mailbox-1--<stripped UUID>@stack-generated.example.com",
        "bounced_at_millis": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "delivered_at_millis": null,
        "failed_at_millis": null,
        "id": "<stripped UUID>",
        "last_error_internal": null,
        "last_error_public": null,
        "message_id": "<stripped UUID>",
        "participant_id": null,
        "provider_message_id": null,
        "sent_at_millis": null,
        "skipped_reason": null,
        "status": "pending",
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
  const deliveryId = createDeliveryResponse.body.id;

  const updateStatusResponse = await niceBackendFetch(`/api/v1/comms/deliveries/${deliveryId}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      status: "sent",
      provider_message_id: "provider-msg-123",
    },
  });
  expect(updateStatusResponse.status).toBe(200);
  expect(updateStatusResponse.body.status).toBe("sent");
  expect(updateStatusResponse.body.provider_message_id).toBe("provider-msg-123");

  const attemptResponse = await niceBackendFetch(`/api/v1/comms/deliveries/${deliveryId}/attempts`, {
    accessType: "server",
    method: "POST",
    body: {
      outcome: "success",
      status: "delivered",
      provider_response: { smtp_code: 250 },
      finished_at_millis: Date.now(),
    },
  });
  expect(attemptResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "attempt": {
          "attempt_number": 1,
          "attempted_at_millis": <stripped field 'attempted_at_millis'>,
          "error_internal": null,
          "error_public": null,
          "finished_at_millis": <stripped field 'finished_at_millis'>,
          "id": "<stripped UUID>",
          "outcome": "success",
          "provider_response": { "smtp_code": 250 },
        },
        "delivery": {
          "address_snapshot": "mailbox-1--<stripped UUID>@stack-generated.example.com",
          "bounced_at_millis": null,
          "created_at_millis": <stripped field 'created_at_millis'>,
          "delivered_at_millis": <stripped field 'delivered_at_millis'>,
          "failed_at_millis": null,
          "id": "<stripped UUID>",
          "last_error_internal": null,
          "last_error_public": null,
          "message_id": "<stripped UUID>",
          "participant_id": null,
          "provider_message_id": "provider-msg-123",
          "sent_at_millis": <stripped field 'sent_at_millis'>,
          "skipped_reason": null,
          "status": "delivered",
          "updated_at_millis": <stripped field 'updated_at_millis'>,
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("does not allow another project to read the first project's contact or message", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const contactResponse = await niceBackendFetch("/api/v1/contacts", {
    accessType: "server",
    method: "POST",
    body: {
      channels: [{ type: "email", value: mailbox.emailAddress }],
    },
  });
  const contactId = contactResponse.body.id;

  const messageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: emailIngestBody({
      externalMessageId: `msg-${generateSecureRandomString()}`,
      fromAddress: mailbox.emailAddress,
    }),
  });
  const messageId = messageResponse.body.id;
  if (typeof contactId !== "string" || typeof messageId !== "string") {
    throw new HexclaveAssertionError("Expected contact and message IDs from project A setup");
  }

  await Project.createAndSwitch();

  const contactReadResponse = await niceBackendFetch(`/api/v1/contacts/${contactId}`, {
    accessType: "server",
  });
  expect(contactReadResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Contact not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const messageReadResponse = await niceBackendFetch(`/api/v1/comms/messages/${messageId}`, {
    accessType: "server",
  });
  expect(messageReadResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Message not found",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
