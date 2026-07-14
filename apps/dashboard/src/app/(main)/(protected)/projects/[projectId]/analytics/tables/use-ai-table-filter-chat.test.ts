import type { ThreadMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import { extractLatestQuery } from "./use-ai-table-filter-chat";

const fixture = (messages: Array<{
  id: string,
  role: "user" | "assistant",
  content: Array<
    | { type: "text", text: string }
    | { type: "tool-call", toolCallId: string, toolName: string, args: { query?: string }, argsText?: string, result: unknown }
  >,
}>) => messages as unknown as readonly ThreadMessage[];

describe("extractLatestQuery", () => {
  it("ignores failed queryAnalytics tool calls and keeps the last successful query", () => {
    const messages = fixture([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "verified users" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "queryAnalytics",
            args: { query: "SELECT 1" },
            argsText: '{"query":"SELECT 1"}',
            result: { success: true },
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        content: [{ type: "text", text: "only recent users" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-2",
            toolName: "queryAnalytics",
            args: { query: "SELECT broken" },
            argsText: '{"query":"SELECT broken"}',
            result: { success: false, error: "boom" },
          },
        ],
      },
    ]);

    const result = extractLatestQuery(messages);

    expect(result).toEqual({
      query: "SELECT 1",
      toolCallIndex: 1,
      requestText: "verified users",
    });
  });

  it("does not reuse a successful query from before the supplied run", () => {
    const currentRun = fixture([
      {
        id: "user-2",
        role: "user",
        content: [{ type: "text", text: "group them by month" }],
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: [{ type: "text", text: "This table view cannot show grouped results." }],
      },
    ]);

    expect(extractLatestQuery(currentRun)).toBeNull();
  });

  it("associates a successful query with the request that produced it", () => {
    const messages = fixture([
      {
        id: "user-1",
        role: "user",
        content: [{ type: "text", text: "verified users" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "queryAnalytics",
            args: { query: "SELECT * FROM users WHERE primary_email_verified = 1" },
            argsText: "",
            result: { success: true },
          },
        ],
      },
    ]);

    expect(extractLatestQuery(messages)).toEqual({
      query: "SELECT * FROM users WHERE primary_email_verified = 1",
      toolCallIndex: 1,
      requestText: "verified users",
    });
  });

  it("returns null while a tool call is still in flight (result == null)", () => {
    const messages = fixture([
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "queryAnalytics",
            args: { query: "SELECT 1" },
            argsText: '{"query":"SELECT 1"}',
            result: null,
          },
        ],
      },
    ]);

    expect(extractLatestQuery(messages)).toBeNull();
  });

  it("ignores tool calls from unrelated tools", () => {
    const messages = fixture([
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "someOtherTool",
            args: { query: "SELECT 1" },
            argsText: '{"query":"SELECT 1"}',
            result: { success: true },
          },
        ],
      },
    ]);

    expect(extractLatestQuery(messages)).toBeNull();
  });
});
