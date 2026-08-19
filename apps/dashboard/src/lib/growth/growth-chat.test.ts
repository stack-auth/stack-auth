import { describe, expect, it } from "vitest";
import {
  buildGrowthChatDemoConversation,
  foldGrowthChatTranscript,
  GROWTH_CHAT_CONVERSATION_DATA_PART_TYPE,
  GROWTH_CHAT_DEMO_CONVERSATION_ID,
  growthChatUiMessageToEntries,
  parseGrowthChatToolPart,
} from "./growth-chat";
import { GROWTH_DEMO_NOW_MILLIS } from "./growth-demo-data";

function assistantMessage(parts: unknown[]): unknown {
  return { id: "m1", role: "assistant", parts };
}

describe("parseGrowthChatToolPart", () => {
  it("maps a successful create-action-item part, extracting the created id from the output", () => {
    const card = parseGrowthChatToolPart("create-action-item", {
      type: "tool-create-action-item",
      toolCallId: "call1",
      state: "output-available",
      input: { title: "Run a retargeting campaign" },
      output: { id: "action-123" },
    });
    expect(card).toEqual({
      kind: "create-action-item",
      label: "Run a retargeting campaign",
      errored: false,
      createdActionItemId: "action-123",
      hasWorkflow: false,
    });
  });

  it("reads the created id from the backend's action_item_id ack and flags an attached workflow", () => {
    const card = parseGrowthChatToolPart("create-action-item", {
      type: "tool-create-action-item",
      toolCallId: "call1",
      state: "output-available",
      input: { title: "Re-engage dormant users", workflow: { workflow_id: "growth-action-x", source: "…", explanation: "…", rollback_note: "…" } },
      output: { action_item_id: "action-456" },
    });
    expect(card).toEqual({
      kind: "create-action-item",
      label: "Re-engage dormant users",
      errored: false,
      createdActionItemId: "action-456",
      hasWorkflow: true,
    });
  });

  it("marks output-error parts as errored and carries no artifact link", () => {
    const card = parseGrowthChatToolPart("save-finding", {
      type: "tool-save-finding",
      toolCallId: "call1",
      state: "output-error",
      input: { summary: "Mobile signups dropped" },
      errorText: "boom",
    });
    expect(card).toEqual({
      kind: "save-finding",
      label: "Mobile signups dropped",
      errored: true,
      createdActionItemId: null,
      hasWorkflow: false,
    });
  });

  it("only reads an action id from an id-carrying output of create-action-item", () => {
    const taskCard = parseGrowthChatToolPart("create-scheduled-task", {
      toolCallId: "call1",
      state: "output-available",
      input: { title: "Daily check" },
      output: { id: "task-1" },
    });
    expect(taskCard?.createdActionItemId).toBeNull();
    const noIdCard = parseGrowthChatToolPart("create-action-item", {
      toolCallId: "call2",
      state: "output-available",
      input: {},
      output: { ok: true },
    });
    expect(noIdCard).toEqual({ kind: "create-action-item", label: null, errored: false, createdActionItemId: null, hasWorkflow: false });
  });

  it("returns null for a part without a toolCallId", () => {
    expect(parseGrowthChatToolPart("create-action-item", { type: "tool-create-action-item", input: {} })).toBeNull();
  });

  it("treats a blank title as no label and falls back from title to summary", () => {
    const blank = parseGrowthChatToolPart("save-finding", { toolCallId: "c", input: { title: "   " } });
    expect(blank?.label).toBeNull();
    const summaryOnly = parseGrowthChatToolPart("save-finding", { toolCallId: "c", input: { summary: "A finding" } });
    expect(summaryOnly?.label).toBe("A finding");
  });
});

describe("growthChatUiMessageToEntries", () => {
  it("extracts text, tool cards, and the conversation id data part from one assistant message", () => {
    const result = growthChatUiMessageToEntries(assistantMessage([
      { type: GROWTH_CHAT_CONVERSATION_DATA_PART_TYPE, id: "d1", data: { conversation_id: "conv-1" } },
      { type: "text", text: "Here you go." },
      { type: "tool-create-scheduled-task", toolCallId: "call1", state: "output-available", input: { title: "Weekly sweep" }, output: null },
    ]), "fallback");
    expect(result.conversationId).toBe("conv-1");
    expect(result.malformed).toEqual([]);
    expect(result.entries).toEqual([
      { type: "text", id: "m1:1", role: "assistant", text: "Here you go." },
      { type: "tool", id: "m1:2", card: { kind: "create-scheduled-task", label: "Weekly sweep", errored: false, createdActionItemId: null, hasWorkflow: false } },
    ]);
  });

  it("skips unknown part types silently but reports renderable-but-broken parts as malformed", () => {
    const result = growthChatUiMessageToEntries(assistantMessage([
      { type: "reasoning", text: "thinking…" },
      { type: "step-start" },
      { type: "tool-some-future-tool", toolCallId: "x", input: {} },
      { type: "text" }, // renderable type, missing text -> malformed
      { type: GROWTH_CHAT_CONVERSATION_DATA_PART_TYPE, data: {} }, // missing conversation_id -> malformed
      { type: "tool-create-action-item", input: {} }, // known tool, missing toolCallId -> malformed
    ]), "fallback");
    expect(result.entries).toEqual([]);
    expect(result.conversationId).toBeNull();
    expect(result.malformed).toHaveLength(3);
  });

  it("skips empty text parts without flagging them", () => {
    const result = growthChatUiMessageToEntries(assistantMessage([{ type: "text", text: "" }]), "fallback");
    expect(result.entries).toEqual([]);
    expect(result.malformed).toEqual([]);
  });

  it("uses the fallback id when the message has none and rejects non-chat roles entirely", () => {
    const noId = growthChatUiMessageToEntries({ role: "user", parts: [{ type: "text", text: "hi" }] }, "loaded:3");
    expect(noId.entries).toEqual([{ type: "text", id: "loaded:3:0", role: "user", text: "hi" }]);
    const system = growthChatUiMessageToEntries({ id: "s", role: "system", parts: [] }, "fallback");
    expect(system.entries).toEqual([]);
    expect(system.malformed).toHaveLength(1);
    const garbage = growthChatUiMessageToEntries("not a message", "fallback");
    expect(garbage.malformed).toEqual(["not a message"]);
  });
});

describe("foldGrowthChatTranscript", () => {
  it("concatenates entries across messages in order and aggregates malformed parts", () => {
    const result = foldGrowthChatTranscript([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Answer." }, { type: "text" }] },
      null,
    ]);
    expect(result.entries.map((entry) => entry.id)).toEqual(["u1:0", "a1:0"]);
    expect(result.malformed).toHaveLength(2);
  });

  it("keys fallback ids by transcript position so entries stay unique without message ids", () => {
    const result = foldGrowthChatTranscript([
      { role: "user", parts: [{ type: "text", text: "one" }] },
      { role: "assistant", parts: [{ type: "text", text: "two" }] },
    ]);
    expect(result.entries.map((entry) => entry.id)).toEqual(["loaded:0:0", "loaded:1:0"]);
  });
});

describe("buildGrowthChatDemoConversation", () => {
  it("is deterministic and anchored to the shared demo clock", () => {
    const first = buildGrowthChatDemoConversation();
    const second = buildGrowthChatDemoConversation();
    expect(first).toEqual(second);
    expect(first.summary.id).toBe(GROWTH_CHAT_DEMO_CONVERSATION_ID);
    expect(first.summary.updatedAtMillis).toBeLessThan(GROWTH_DEMO_NOW_MILLIS);
    expect(first.summary.createdAtMillis).toBeLessThan(first.summary.updatedAtMillis);
  });

  it("contains a coherent read-only transcript with at least one tool card", () => {
    const { entries } = buildGrowthChatDemoConversation();
    expect(entries[0]).toMatchObject({ type: "text", role: "user" });
    expect(entries.some((entry) => entry.type === "tool" && !entry.card.errored)).toBe(true);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });
});
