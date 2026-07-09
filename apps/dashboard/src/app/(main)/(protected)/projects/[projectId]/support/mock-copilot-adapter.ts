import type { ChatModelAdapter, ChatModelRunOptions, ChatModelRunResult, ThreadAssistantContentPart, ThreadMessageLike } from "@assistant-ui/react";
import { waitForApproval } from "./approval-store";
import type { CopilotToolCall, CopilotTurn, DemoConversation } from "./fixtures";

// Read through a function call so TS doesn't narrow `signal.aborted` to a
// constant across awaits — it genuinely flips when the run is cancelled.
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function sleep(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abortSignal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function toolCallPart(toolCall: CopilotToolCall, index: number, withResult: boolean): ThreadAssistantContentPart {
  return {
    type: "tool-call",
    toolCallId: `mock-${toolCall.toolName}-${index}`,
    toolName: toolCall.toolName,
    args: toolCall.args,
    argsText: JSON.stringify(toolCall.args),
    ...(withResult ? { result: toolCall.result } : {}),
  };
}

/** The copilot's opening analysis, pre-seeded into the thread with completed tool calls. */
export function buildInitialCopilotMessages(conversation: DemoConversation): ThreadMessageLike[] {
  const turn = conversation.copilot.initial;
  const content: ThreadAssistantContentPart[] = [
    ...(turn.toolCalls ?? []).map((toolCall, index) => toolCallPart(toolCall, index, true)),
    { type: "text", text: turn.text },
  ];
  return [{ id: `${conversation.id}-copilot-initial`, role: "assistant", content }];
}

function lastUserText(messages: ChatModelRunOptions["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    return message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ");
  }
  return "";
}

/**
 * Deterministic stand-in for the unified AI endpoint: streams the next canned
 * turn for this conversation, tool calls first, then the text word by word.
 * Keyword-matched actions (refunds, re-syncs, publishes) take precedence over
 * the index-based canned responses; their `threadEffect` is reported through
 * `onThreadEffect` so the customer thread reflects the mutation.
 */
export function createMockCopilotAdapter(
  conversation: DemoConversation,
  callbacks?: { onThreadEffect?: (body: string) => void, onRunStart?: () => void },
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      callbacks?.onRunStart?.();
      const userTurnIndex = messages.filter((message) => message.role === "user").length - 1;
      const responses = conversation.copilot.responses;
      const question = lastUserText(messages).toLowerCase();
      const action = conversation.copilot.actions?.find((candidate) =>
        candidate.triggers.some((trigger) => question.includes(trigger)));
      const turn: CopilotTurn = action
        ? action.turn
        : userTurnIndex >= 0 && userTurnIndex < responses.length
          ? responses[userTurnIndex]
          : { text: conversation.copilot.fallback };

      const settledParts: ThreadAssistantContentPart[] = [];

      await sleep(500, abortSignal);
      if (isAborted(abortSignal)) return;

      // Write-actions pause on an approval card until the operator decides.
      if (action) {
        const approvalId = `approval-${conversation.id}-${userTurnIndex}`;
        const approvalArgs = { action: action.approval.title, summary: action.approval.summary };
        const approvalPart = {
          type: "tool-call" as const,
          toolCallId: approvalId,
          toolName: "request-approval",
          args: approvalArgs,
          argsText: JSON.stringify(approvalArgs),
        };
        yield { content: [...settledParts, approvalPart] };
        const approved = await waitForApproval(approvalId, abortSignal);
        if (isAborted(abortSignal)) return;
        settledParts.push({ ...approvalPart, result: { approved } });
        yield { content: [...settledParts] };
        if (!approved) {
          yield { content: [...settledParts, { type: "text", text: "Understood — I didn't run it. Nothing was changed." }] };
          return;
        }
        await sleep(400, abortSignal);
        if (isAborted(abortSignal)) return;
      }

      for (const [index, toolCall] of (turn.toolCalls ?? []).entries()) {
        yield { content: [...settledParts, toolCallPart(toolCall, index, false)] };
        await sleep(1100, abortSignal);
        if (isAborted(abortSignal)) return;
        settledParts.push(toolCallPart(toolCall, index, true));
        yield { content: [...settledParts] };
        await sleep(250, abortSignal);
        if (isAborted(abortSignal)) return;
      }

      const words = turn.text.split(" ");
      let partialText = "";
      for (const word of words) {
        partialText = partialText === "" ? word : `${partialText} ${word}`;
        yield { content: [...settledParts, { type: "text", text: partialText }] };
        await sleep(24, abortSignal);
        if (isAborted(abortSignal)) return;
      }

      if (action?.threadEffect) {
        callbacks?.onThreadEffect?.(action.threadEffect);
      }
    },
  };
}
