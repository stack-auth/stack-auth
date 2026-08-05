import { describe, expect, it } from "vitest";
import { getRequestedBrainTool, getRequestedBrainToolForTurn } from "./generate";

describe("getRequestedBrainTool", () => {
  it("forces analytics for explicit rerun requests", () => {
    expect(getRequestedBrainTool([{
      role: "user",
      content: "Please rerun the analytics and do not reuse the previous answer.",
    }])).toBe("queryAnalytics");
  });

  it("routes queue and config requests to their tools", () => {
    expect(getRequestedBrainTool([{
      role: "user",
      content: "List the current queue items.",
    }])).toBe("executeBrainJavascript");
    expect(getRequestedBrainTool([{
      role: "user",
      content: "Read the current project configuration.",
    }])).toBe("readBranchConfig");
  });

  it("does not force a tool for ordinary conversation", () => {
    expect(getRequestedBrainTool([{
      role: "user",
      content: "Hey, what can you help me with?",
    }])).toBeNull();
  });

  it("preserves pending human tool intent ahead of a later hidden queue wake", () => {
    const visibleMessages = [{
      role: "user" as const,
      content: "Read the current project configuration.",
    }];
    const messages = [
      ...visibleMessages,
      {
        role: "user" as const,
        content: "There are 100 items in the brain queue, please process all or some of them.",
      },
    ];

    expect(getRequestedBrainToolForTurn({
      messages,
      visibleMessages,
      needsHumanReply: true,
      pendingCount: 100,
    })).toBe("readBranchConfig");
    expect(getRequestedBrainToolForTurn({
      messages: [messages[1]],
      visibleMessages: [],
      needsHumanReply: false,
      pendingCount: 100,
    })).toBe("executeBrainJavascript");
  });
});
