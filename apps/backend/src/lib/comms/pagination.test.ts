import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { describe, expect, it } from "vitest";
import { parseCommsMessageCursor } from "./pagination";

describe("parseCommsMessageCursor", () => {
  it("parses generated timestamp and message ID cursors", () => {
    const messageId = generateUuid();
    expect(parseCommsMessageCursor(`1700000000000:${messageId}`)).toEqual({
      occurredAtMillis: 1_700_000_000_000,
      messageId,
    });
    expect(parseCommsMessageCursor(undefined)).toEqual({});
  });

  it.each([
    "",
    ":not-an-id",
    ` 1:${generateUuid()}`,
    `1.5:${generateUuid()}`,
    `1e3:${generateUuid()}`,
    `8640000000000001:${generateUuid()}`,
    "1700000000000:not-an-id",
  ])("rejects malformed cursor %j", (cursor) => {
    expect(() => parseCommsMessageCursor(cursor)).toThrow("Invalid message cursor");
  });
});
