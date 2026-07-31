import { describe, expect, it } from "vitest";
import { serverContactChannelCreateOptionsToCrud } from "../contacts";
import {
  serverCommsDeliveryStatusUpdateOptionsToCrud,
  serverCommsMessageCreateOptionsToCrud,
} from ".";

describe("communications SDK wire mapping", () => {
  it("maps the complete camelCase message shape to snake_case only at the REST boundary", () => {
    expect(serverCommsMessageCreateOptionsToCrud({
      direction: "inbound",
      adapterKey: "email:primary",
      externalMessageId: "message-123",
      occurredAt: new Date(1_000),
      payload: {
        type: "email",
        version: 1,
        subject: "Hello",
        textBody: "Text",
        htmlBody: null,
        ampHtmlBody: null,
        headers: [{ name: "Message-ID", value: "<message-123@example.com>" }],
      },
      participants: [{
        role: "from",
        contactChannel: {
          type: "slack",
          value: "U123",
          workspaceId: "T456",
        },
        displayNameSnapshot: "Ada",
      }],
      attachments: [{
        filename: "hello.txt",
        contentType: "text/plain",
        sizeBytes: 4,
      }],
    }, serverContactChannelCreateOptionsToCrud)).toMatchInlineSnapshot(`
      {
        "adapter_key": "email:primary",
        "attachments": [
          {
            "content_id": undefined,
            "content_type": "text/plain",
            "filename": "hello.txt",
            "is_inline": undefined,
            "metadata": undefined,
            "size_bytes": 4,
            "storage_key": undefined,
          },
        ],
        "conversation_id": undefined,
        "direction": "inbound",
        "external_message_id": "message-123",
        "external_thread_id": undefined,
        "occurred_at_millis": 1000,
        "participants": [
          {
            "address_snapshot": undefined,
            "channel": {
              "is_primary": undefined,
              "is_verified": undefined,
              "metadata": undefined,
              "type": "slack",
              "value": "U123",
              "workspace_id": "T456",
            },
            "contact_channel_id": undefined,
            "contact_id": undefined,
            "display_name_snapshot": "Ada",
            "position": undefined,
            "role": "from",
          },
        ],
        "payload": {
          "amp_html_body": null,
          "headers": [
            {
              "name": "Message-ID",
              "value": "<message-123@example.com>",
            },
          ],
          "html_body": null,
          "subject": "Hello",
          "text_body": "Text",
          "type": "email",
          "version": 1,
        },
        "raw_blob_key": undefined,
        "relations": undefined,
        "reply_to_message_id": undefined,
      }
    `);
  });

  it("maps delivery lifecycle updates without exposing wire casing", () => {
    expect(serverCommsDeliveryStatusUpdateOptionsToCrud({
      status: "delivered",
      providerMessageId: "provider-123",
      lastErrorPublic: null,
    })).toMatchInlineSnapshot(`
      {
        "last_error_internal": undefined,
        "last_error_public": null,
        "provider_message_id": "provider-123",
        "skipped_reason": undefined,
        "status": "delivered",
      }
    `);
  });
});
