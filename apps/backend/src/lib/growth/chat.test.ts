import { describe, expect, it } from "vitest";
import { chunksFromGrowthAssistantMessage, deriveGrowthChatTitle, parseEveChatResponse } from "./chat";

// The persistence + proxy flow (streamGrowthChatTurn) needs a live database and Eve and is covered
// by the e2e suite (apps/e2e .../growth/chat.test.ts) for its failure semantics; the happy path
// cannot run without a real Eve (documented gap there). These tests pin the pure wire-shaping
// helpers instead.

describe("deriveGrowthChatTitle", () => {
  it("collapses whitespace and trims", () => {
    expect(deriveGrowthChatTitle("  why   did\n\nsignups  drop?  ")).toBe("why did signups drop?");
  });

  it("falls back for all-whitespace messages", () => {
    expect(deriveGrowthChatTitle("   \n\t ")).toBe("Growth chat");
  });

  it("elides long messages to the sidebar budget", () => {
    const title = deriveGrowthChatTitle("a".repeat(500));
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
    expect(title.startsWith("a".repeat(79))).toBe(true);
  });

  it("keeps exactly-at-budget messages unelided", () => {
    expect(deriveGrowthChatTitle("b".repeat(80))).toBe("b".repeat(80));
  });
});

describe("parseEveChatResponse", () => {
  const validMessage = { id: "m1", role: "assistant", parts: [{ type: "text", text: "Hi" }] };

  it("accepts a well-formed body", () => {
    expect(parseEveChatResponse({ message: validMessage })).toEqual(validMessage);
  });

  it.each([
    ["null", null],
    ["missing message", {}],
    ["array message", { message: [] }],
    ["missing id", { message: { role: "assistant", parts: [] } }],
    ["wrong role", { message: { id: "m1", role: "user", parts: [] } }],
    ["non-array parts", { message: { id: "m1", role: "assistant", parts: {} } }],
    ["part without type", { message: { id: "m1", role: "assistant", parts: [{ text: "hi" }] } }],
    ["non-object part", { message: { id: "m1", role: "assistant", parts: ["hi"] } }],
  ])("rejects %s", (_label, body) => {
    expect(parseEveChatResponse(body)).toBeNull();
  });
});

describe("chunksFromGrowthAssistantMessage", () => {
  it("synthesizes the single-shot chunk sequence with the conversation id data part first", () => {
    const chunks = chunksFromGrowthAssistantMessage({
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Here you go." },
        { type: "tool-create-action-item", toolCallId: "call1", state: "output-available", input: { title: "Do it" }, output: { id: "a1" } },
      ],
    }, "conv-1");
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "data-growth-conversation",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-available",
      "tool-output-available",
      "finish-step",
      "finish",
    ]);
    expect(chunks[1]).toMatchObject({ type: "data-growth-conversation", data: { conversation_id: "conv-1" } });
    expect(chunks.find((chunk) => chunk.type === "tool-input-available")).toMatchObject({ toolName: "create-action-item", input: { title: "Do it" } });
  });

  it("emits tool-output-error for failed tool parts and drops unknown part types from the stream", () => {
    const chunks = chunksFromGrowthAssistantMessage({
      id: "m1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "hmm" },
        { type: "tool-save-finding", toolCallId: "call1", state: "output-error", input: {}, errorText: "boom" },
      ],
    }, "conv-1");
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "data-growth-conversation",
      "start-step",
      "tool-input-available",
      "tool-output-error",
      "finish-step",
      "finish",
    ]);
    expect(chunks.find((chunk) => chunk.type === "tool-output-error")).toMatchObject({ errorText: "boom" });
  });
});
