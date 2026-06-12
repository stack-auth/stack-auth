/**
 * Regression coverage for the Anthropic "Invalid `signature` in `thinking`
 * block" 400 (OpenRouterTeam/ai-sdk-provider #423/#439).
 *
 * @openrouter/ai-sdk-provider@2.2.3 drops the thinking-block signature during
 * streaming, so a replayed assistant turn carries `reasoning.text` details
 * with text but no signature. Anthropic rejects those on the next turn.
 * `sanitizeAnthropicReasoning` strips the unsigned reasoning before replay
 * while preserving properly signed/encrypted reasoning.
 */
import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { sanitizeAnthropicReasoning } from "./sanitize-reasoning";

function reasoningDetails(message: ModelMessage): unknown {
  const po = (message as { providerOptions?: { openrouter?: { reasoning_details?: unknown } } }).providerOptions;
  return po?.openrouter?.reasoning_details;
}

describe("sanitizeAnthropicReasoning", () => {
  it("drops a reasoning part whose details lack a signature", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "let me think...",
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  { type: "reasoning.text", text: "let me think...", format: "anthropic-claude-v1" },
                ],
              },
            },
          },
          { type: "text", text: "The answer is 4." },
        ],
      } as ModelMessage,
    ];

    const [out] = sanitizeAnthropicReasoning(messages);
    const content = out.content as Array<{ type: string }>;
    expect(content.map(p => p.type)).toEqual(["text"]);
  });

  it("keeps a reasoning part with a valid signature and strips only the unsigned siblings", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "signed thought",
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  { type: "reasoning.text", text: "signed thought", signature: "sig-abc", format: "anthropic-claude-v1" },
                  { type: "reasoning.text", text: "unsigned tail", format: "anthropic-claude-v1" },
                ],
              },
            },
          },
        ],
      } as ModelMessage,
    ];

    const [out] = sanitizeAnthropicReasoning(messages);
    const content = out.content as Array<{ type: string, providerOptions?: { openrouter?: { reasoning_details?: Array<{ signature?: string }> } } }>;
    expect(content).toHaveLength(1);
    const kept = content[0].providerOptions?.openrouter?.reasoning_details ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0].signature).toBe("sig-abc");
  });

  it("keeps encrypted reasoning details (no signature required)", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  { type: "reasoning.encrypted", data: "AAAA", format: "anthropic-claude-v1" },
                ],
              },
            },
          },
        ],
      } as ModelMessage,
    ];

    const [out] = sanitizeAnthropicReasoning(messages);
    expect(out.content as Array<unknown>).toHaveLength(1);
  });

  it("scrubs unsigned details from the assistant message-level providerOptions", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        providerOptions: {
          openrouter: {
            reasoning_details: [
              { type: "reasoning.text", text: "unsigned", format: "anthropic-claude-v1" },
              { type: "reasoning.text", text: "signed", signature: "sig-1", format: "anthropic-claude-v1" },
            ],
          },
        },
      } as ModelMessage,
    ];

    const [out] = sanitizeAnthropicReasoning(messages);
    const details = reasoningDetails(out) as Array<{ signature?: string }>;
    expect(details).toHaveLength(1);
    expect(details[0].signature).toBe("sig-1");
  });

  it("scrubs unsigned reasoning_details attached to a tool-call part", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "doThing",
            input: {},
            providerOptions: {
              openrouter: {
                reasoning_details: [
                  { type: "reasoning.text", text: "unsigned", format: "anthropic-claude-v1" },
                ],
              },
            },
          },
        ],
      } as ModelMessage,
    ];

    const [out] = sanitizeAnthropicReasoning(messages);
    const toolPart = (out.content as Array<{ providerOptions?: { openrouter?: Record<string, unknown> } }>)[0];
    expect(toolPart.providerOptions?.openrouter?.reasoning_details).toBeUndefined();
  });

  it("leaves user messages untouched", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] } as ModelMessage,
    ];
    const out = sanitizeAnthropicReasoning(messages);
    expect(out[0]).toEqual(messages[0]);
  });
});
