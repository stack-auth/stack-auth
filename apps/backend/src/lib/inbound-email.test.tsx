import { describe, expect, it } from "vitest";
import { INBOUND_CONVERSATION_HEADER, parseInboundResendPayload } from "./inbound-email";

describe("parseInboundResendPayload", () => {
  it("parses a basic inbound email with a named sender", () => {
    const parsed = parseInboundResendPayload({
      type: "email.received",
      data: {
        from: "Jane Doe <jane@example.com>",
        to: ["support@mail.acme.com"],
        subject: "Help please",
        text: "My login is broken.",
      },
    });
    expect(parsed).toEqual({
      fromEmail: "jane@example.com",
      fromName: "Jane Doe",
      recipients: ["support@mail.acme.com"],
      subject: "Help please",
      body: "My login is broken.",
      conversationIdHeader: null,
    });
  });

  it("accepts a bare sender and a string `to`", () => {
    const parsed = parseInboundResendPayload({
      data: { from: "bob@example.com", to: "support@mail.acme.com", subject: "Hi", text: "hello" },
    });
    expect(parsed?.fromEmail).toBe("bob@example.com");
    expect(parsed?.fromName).toBeNull();
    expect(parsed?.recipients).toEqual(["support@mail.acme.com"]);
  });

  it("falls back to stripped HTML when there is no text part", () => {
    const parsed = parseInboundResendPayload({
      data: {
        from: "a@b.com",
        to: ["support@mail.acme.com"],
        subject: "HTML only",
        html: "<p>Hello <strong>world</strong></p><script>alert(1)</script>",
      },
    });
    expect(parsed?.body).toBe("Hello world");
  });

  it("extracts the conversation-id header from an array of headers", () => {
    const parsed = parseInboundResendPayload({
      data: {
        from: "a@b.com",
        to: ["support@mail.acme.com"],
        subject: "Re: ticket",
        text: "more info",
        headers: [
          { name: "X-Other", value: "ignore" },
          { name: "X-Hexclave-Conversation-Id", value: "abc-123" },
        ],
      },
    });
    expect(parsed?.conversationIdHeader).toBe("abc-123");
  });

  it("extracts the conversation-id header from a header object (case-insensitive)", () => {
    const parsed = parseInboundResendPayload({
      data: {
        from: "a@b.com",
        to: ["support@mail.acme.com"],
        subject: "Re: ticket",
        text: "more info",
        headers: { "x-hexclave-conversation-id": "obj-456" },
      },
    });
    expect(parsed?.conversationIdHeader).toBe("obj-456");
    expect(INBOUND_CONVERSATION_HEADER).toBe("x-hexclave-conversation-id");
  });

  it("defaults a missing subject", () => {
    const parsed = parseInboundResendPayload({
      data: { from: "a@b.com", to: ["support@mail.acme.com"], text: "no subject here" },
    });
    expect(parsed?.subject).toBe("(no subject)");
  });

  it("returns null when the sender is missing", () => {
    expect(parseInboundResendPayload({ data: { to: ["support@mail.acme.com"], subject: "x" } })).toBeNull();
  });

  it("returns null for a malformed payload", () => {
    expect(parseInboundResendPayload(null)).toBeNull();
    expect(parseInboundResendPayload({})).toBeNull();
    expect(parseInboundResendPayload({ data: "nope" })).toBeNull();
  });
});
