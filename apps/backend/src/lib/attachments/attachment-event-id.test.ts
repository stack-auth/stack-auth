import { describe, expect, it } from "vitest";
import { getErrorAttachmentEventId } from "./attachment-event-id";

const EVENT_ID = "0123456789abcdef0123456789abcdef";

describe("getErrorAttachmentEventId", () => {
  it("prefers the canonical envelope event id", () => {
    expect(getErrorAttachmentEventId({
      occurrenceId: "f".repeat(32),
      data: { event_id: "e".repeat(32) },
      errorEnvelope: { event_id: EVENT_ID },
    })).toBe(EVENT_ID);
  });

  it("uses strict legacy event-id fallbacks", () => {
    expect(getErrorAttachmentEventId({ occurrenceId: EVENT_ID, data: {}, errorEnvelope: null })).toBe(EVENT_ID);
    expect(getErrorAttachmentEventId({ occurrenceId: "occurrence-1", data: { event_id: EVENT_ID.toUpperCase() }, errorEnvelope: null })).toBe(EVENT_ID);
  });

  it("does not guess from arbitrary occurrence identifiers", () => {
    expect(getErrorAttachmentEventId({
      occurrenceId: "occurrence-1",
      data: { event_id: "not-an-event" },
      errorEnvelope: { event_id: "also-not-an-event" },
    })).toBeNull();
  });
});
