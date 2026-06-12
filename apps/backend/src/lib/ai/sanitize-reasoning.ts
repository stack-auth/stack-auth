import type { ModelMessage } from "ai";

// Anthropic validates that every `thinking` block replayed in a multi-turn
// request carries a cryptographically valid `signature`. When it's missing or
// corrupted, Anthropic rejects the whole request with HTTP 400
// "messages.N.content.0: Invalid `signature` in `thinking` block".
//
// `@openrouter/ai-sdk-provider` < 2.4.x (we pin 2.2.3) drops the signature
// during streaming: the signature arrives in a trailing signature-only delta
// that the SDK never propagates back onto the reasoning part's
// providerMetadata. The stored assistant turn therefore ends up with
// `reasoning.text` details that have text but no `signature`, and replaying
// them on the next turn 400s.
//
// This mirrors the upstream fix (OpenRouterTeam/ai-sdk-provider PR #442/#445):
// before sending, strip reasoning that can't be safely replayed. Properly
// signed (or encrypted) reasoning is preserved, so once the provider is bumped
// to a fixed version this becomes a no-op for valid data.

type ReasoningDetail = { type?: string, signature?: unknown, data?: unknown };

// A detail is safe to replay to Anthropic when it carries the proof Anthropic
// needs: a non-empty signature for text blocks, or encrypted payload data.
// Summaries aren't subject to signature validation. Unknown shapes are left
// untouched — we only target the known-broken signatureless-text case.
function isReplayableDetail(detail: ReasoningDetail): boolean {
  switch (detail.type) {
    case "reasoning.text": {
      return typeof detail.signature === "string" && detail.signature.length > 0;
    }
    case "reasoning.encrypted": {
      return detail.data != null;
    }
    default: {
      return true;
    }
  }
}

function readReasoningDetails(providerOptions: unknown): ReasoningDetail[] | undefined {
  if (providerOptions == null || typeof providerOptions !== "object") return undefined;
  const openrouter = (providerOptions as Record<string, unknown>).openrouter;
  if (openrouter == null || typeof openrouter !== "object") return undefined;
  const details = (openrouter as Record<string, unknown>).reasoning_details;
  return Array.isArray(details) ? details as ReasoningDetail[] : undefined;
}

// Returns providerOptions with any signatureless reasoning details removed.
// Drops the `reasoning_details` key entirely when nothing replayable remains.
function scrubProviderOptions<T>(providerOptions: T): T {
  const details = readReasoningDetails(providerOptions);
  if (details === undefined) return providerOptions;
  const kept = details.filter(isReplayableDetail);
  const po = providerOptions as Record<string, unknown>;
  const openrouter = { ...(po.openrouter as Record<string, unknown>) };
  if (kept.length > 0) {
    openrouter.reasoning_details = kept;
  } else {
    delete openrouter.reasoning_details;
  }
  return { ...po, openrouter } as T;
}

/**
 * Strip reasoning that Anthropic would reject on replay (missing/invalid
 * signature). Only intended for Anthropic model requests; other providers have
 * their own reasoning replay semantics and are left untouched by callers.
 *
 * - Reasoning content parts are kept only if they still carry at least one
 *   replayable detail; otherwise the part is dropped so the provider doesn't
 *   emit an unsigned `reasoning`/thinking block.
 * - `reasoning_details` arrays on the message, on surviving reasoning parts,
 *   and on tool-call parts are scrubbed to replayable entries only.
 */
type AssistantPart = Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string>[number];

export function sanitizeAnthropicReasoning(messages: ReadonlyArray<ModelMessage>): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return message;

    const sanitizedContent = message.content.flatMap((part): AssistantPart[] => {
      if (part.type === "reasoning") {
        const scrubbed = scrubProviderOptions(part.providerOptions);
        const kept = readReasoningDetails(scrubbed);
        // No replayable detail left → drop the whole reasoning part (text and
        // all), matching the upstream "strip reasoning when details missing".
        if (kept === undefined || kept.length === 0) return [];
        return [{ ...part, providerOptions: scrubbed }];
      }
      if ("providerOptions" in part && part.providerOptions != null) {
        return [{ ...part, providerOptions: scrubProviderOptions(part.providerOptions) }];
      }
      return [part];
    }) as ModelMessage["content"];

    return {
      ...message,
      content: sanitizedContent,
      ...(message.providerOptions != null
        ? { providerOptions: scrubProviderOptions(message.providerOptions) }
        : {}),
    } as ModelMessage;
  });
}
