import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import { extractLatestQuery } from "./use-ai-query-chat";

describe("extractLatestQuery", () => {
  it("ignores failed queryAnalytics tool calls and keeps the last successful query", () => {
    const messages = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-queryAnalytics",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "SELECT 1" },
            output: { success: true },
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          {
            type: "tool-queryAnalytics",
            toolCallId: "call-2",
            state: "output-error",
            input: { query: "SELECT broken" },
            errorText: "boom",
          },
        ],
      },
    ] satisfies UIMessage[];

    const result = extractLatestQuery(messages);

    expect(result).toEqual({
      query: "SELECT 1",
      state: "output-available",
      toolCallIndex: 2,
    });
  });
});
