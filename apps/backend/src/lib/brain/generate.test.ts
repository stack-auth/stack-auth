import { describe, expect, it } from "vitest";
import { getRequestedBrainTool } from "./generate";

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
    }])).toBe("listBrainQueueItems");
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
});
