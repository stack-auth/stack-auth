import type { ChannelFrom } from "eve/channels";
import { buildGrowthSessionAuth, GROWTH_CHAT_PHASE_KEY } from "#lib/run-context.ts";
import { followSessionEvents } from "#lib/session-stream.ts";
import type { GrowthAgentTokenRef, GrowthProjectRef } from "#lib/types.ts";
import { WRITING_STYLE_RULES } from "#lib/writing-style.ts";


/** Inbound body of POST /chat (backend -> agent). */
export type ChatTurnRequest = GrowthProjectRef & GrowthAgentTokenRef & {
  readonly turn_id: string,
  /** AI SDK UIMessages (ending with the latest user message), opaque prompt context here. */
  readonly transcript: readonly unknown[],
};


type AssistantTextPart = {
  readonly type: "text",
  readonly text: string,
  readonly state: "done",
};

type AssistantToolPart = {
  readonly type: `tool-${string}`,
  readonly toolCallId: string,
  state: "input-available" | "output-available" | "output-error",
  readonly input: unknown,
  output?: unknown,
  errorText?: string,
};

export type AssistantUiMessage = {
  readonly id: string,
  readonly role: "assistant",
  readonly parts: (AssistantTextPart | AssistantToolPart)[],
};

export type ChatTurnResult = {
  readonly message: AssistantUiMessage,
};

/**
 * Incremental events emitted while the turn runs. Intentionally a SEPARATE vocabulary from the AI
 * SDK's `UIMessageChunk`: this is the agent-to-backend wire, and the backend owns the translation
 * into UI chunks (it also has to interleave its own `data-growth-conversation` part). Keeping the
 * agent free of AI-SDK chunk types means a UI-vocabulary change never requires an agent redeploy.
 *
 * `id` groups deltas into one text block; see TEXT BLOCK KEYING in executeChatTurn.
 */
export type ChatTurnStreamEvent =
  | { readonly type: "text-start", readonly id: string }
  | { readonly type: "text-delta", readonly id: string, readonly delta: string }
  | { readonly type: "text-end", readonly id: string }
  | { readonly type: "tool-input", readonly toolCallId: string, readonly toolName: string, readonly input: unknown }
  | { readonly type: "tool-output", readonly toolCallId: string, readonly output: unknown }
  | { readonly type: "tool-error", readonly toolCallId: string, readonly errorText: string };

/**
 * The tools whose calls are projected into the assistant message: the ones that create
 * user-visible artifacts the chat page can render as cards (action items, saved findings).
 * Data-access and workflow-authoring tool traffic (sql-query, get-metrics, get-project-context,
 * get-context-bundle, get-workflow-authoring-context, validate-workflow) is deliberately NOT
 * projected — it is internal plumbing, and the dashboard must never render raw SQL, DTS blobs, or
 * validation feedback into the customer-facing transcript. The interview tools cannot fire at all
 * in chat sessions (their context guard requires an analysis-run interview session; see
 * run-context.ts).
 */
const PROJECTED_CHAT_TOOLS = new Set(["create-action-item", "save-finding"]);

/**
 * Upper bound on one chat turn. Chat turns may run several data-tool calls (unlike the short
 * interview exchanges), but the backend gives up at 120s anyway — this cap only converts "stuck
 * forever" into an error after the backend has long since surfaced its retryable 502.
 */
const MAX_CHAT_TURN_MS = 5 * 60 * 1000;

function buildChatTurnPrompt(input: ChatTurnRequest): string {
  return [
    `You are the growth assistant for project ${input.project_id} (branch ${input.branch_id}), chatting with the project's team inside their Growth dashboard.`,
    "",
    "The conversation transcript so far (AI SDK UIMessages; the LAST message is the user's latest message, which you must answer):",
    "```json",
    JSON.stringify(input.transcript, null, 2),
    "```",
    "",
    "Run exactly ONE chat turn: answer the user's latest message, then stop.",
    "",
    "How to work:",
    "1. If this is the conversation's opening turn (the transcript has a single user message), call `get-context-bundle` FIRST to load the project's growth context (findings, interview answers, latest report/brief) before answering.",
    "2. Ground every claim in tool results: use `sql-query` and `get-metrics` for data questions, and `get-project-context` / `get-context-bundle` for qualitative context. Never invent numbers.",
    "3. When the user asks you to set something up, you may call `create-action-item` (a concrete task for their team). Only do this when the user clearly asked for it; confirm what you created in your reply.",
    "4. If the conversation surfaces a durable, grounded insight worth keeping, you may persist it with `save-finding`.",
    "",
    "Automations: when the user wants something done automatically, attach a workflow to the action item. Only automate mechanically-computable work (recurring metric checks, one-shot executions, reactive event sequences); judgment-requiring monitoring stays a plain action item. Trigger recipes: one-shot workflows subscribe to customEvent(\"growth.action.<slug>\") fired when the customer activates the item; recurring ones use a coarse cron schedule (hourly or slower); reactive ones subscribe to platform events with an entity-derived runKey. Authoring loop: call `get-workflow-authoring-context` ONCE, write the source, then `validate-workflow` and fix until valid (max 4 attempts — after that create the action item without a workflow and explain the steps instead). Id prefix: growth-action- for one-shots/reactive, growth-task- for recurring schedules. NEVER put secrets or API keys in workflow source; it is displayed verbatim in the customer dashboard.",
    "",
    "Paid acquisition: if the user asks about running ads, you can discuss strategy and propose a campaign as a `run_ads` action item — who to target, the angle, roughly what to spend — for them to act on. Always state any ad budget with its currency spelled out (e.g. \"$30/day (USD)\"). You cannot read their ad account, so never state ad performance numbers; say plainly that you can't see their campaigns rather than guessing. You never launch, publish, pause, or spend anything yourself — say so plainly if the user asks you to.",
    "",
    "Rules:",
    "- Do not call any tools other than: get-context-bundle, get-project-context, get-metrics, sql-query, create-action-item, save-finding, get-workflow-authoring-context, validate-workflow. In particular, NEVER call interview or report tools.",
    "- The user answers through the chat UI, not in this session — never wait for a reply.",
    "- Your text messages are shown to the user verbatim: concise markdown, **bold** key numbers, no internal jargon (no ids, tool names, SQL, or JSON dumps).",
    "",
    WRITING_STYLE_RULES,
    // Chat is the one surface with a live human on the other end, so it gets a tighter ceiling than
    // the shared targets: a reader who wants more can just ask, which is not true of a report.
    "- In chat specifically, answer in a few sentences or a short list. Save the long version for when the user asks for it.",
  ].join("\n");
}

/**
 * Runs the chat-turn agent session and assembles the assistant UIMessage from the session's
 * durable event stream (`message.completed` -> text part, `actions.requested`/`action.result` ->
 * projected tool parts). The collection loop mirrors executeInterviewTurn in run-interview.ts;
 * kept local for the same reason its author kept theirs local (each turn kind is self-contained,
 * and a shared helper would couple their evolution).
 */
export async function executeChatTurn(input: ChatTurnRequest, helpers: { readonly from: ChannelFrom }): Promise<ChatTurnResult> {
  const session = await helpers.from(`chat:${input.turn_id}`).send(buildChatTurnPrompt(input), {
    auth: buildGrowthSessionAuth({
      project_id: input.project_id,
      branch_id: input.branch_id,
      // Chat sessions carry the chat sentinel phase key and NO run_id: together these lock the
      // interview-only tools out (they require an analysis-run interview session) while the
      // run-agnostic tools (sql-query, save-finding, ...) keep working project-wide.
      phase_key: GROWTH_CHAT_PHASE_KEY,
      finding_source: "chat",
      agent_token: input.agent_token,
    }),
    mode: "task",
    title: `Growth chat turn (project ${input.project_id})`,
    // Retries must queue behind an in-flight run instead of steering it away.
    turnPolicy: "queue",
  });

  const parts: AssistantUiMessage["parts"] = [];
  const toolPartsByCallId = new Map<string, AssistantToolPart>();
  // Text already projected into `parts` — see the dedupe rationale in run-interview.ts: one
  // `message.completed` fires per step, so a tool-calling turn repeats its pre-call prose.
  const seenTextParts = new Set<string>();

  collect: for await (const event of followSessionEvents({ session, label: "Chat turn", maxSessionMs: MAX_CHAT_TURN_MS })) {
    switch (event.type) {
      case "message.completed": {
        if (event.data.message != null && event.data.message.length > 0) {
          if (!seenTextParts.has(event.data.message)) {
            seenTextParts.add(event.data.message);
            parts.push({ type: "text", text: event.data.message, state: "done" });
          }
        }
        break;
      }
      case "actions.requested": {
        for (const action of event.data.actions) {
          if (action.kind !== "tool-call" || !PROJECTED_CHAT_TOOLS.has(action.toolName)) continue;
          const part: AssistantToolPart = {
            type: `tool-${action.toolName}`,
            toolCallId: action.callId,
            state: "input-available",
            input: action.input,
          };
          parts.push(part);
          toolPartsByCallId.set(action.callId, part);
        }
        break;
      }
      case "action.result": {
        const result = event.data.result;
        if (result.kind !== "tool-result") break;
        const part = toolPartsByCallId.get(result.callId);
        if (part == null) break;
        if (event.data.status === "completed") {
          part.state = "output-available";
          part.output = result.output;
        } else {
          part.state = "output-error";
          part.errorText = event.data.error?.message ?? "Tool call failed";
        }
        break;
      }
      case "session.completed": {
        break collect;
      }
      case "session.failed": {
        throw new Error(`Chat turn session failed: session=${session.id} code=${event.data.code} message=${event.data.message}`);
      }
      case "session.waiting": {
        throw new Error(`Chat turn session parked waiting for input in task mode: session=${session.id}`);
      }
      default: {
        break;
      }
    }
  }

  if (parts.length === 0) {
    throw new Error(`Chat turn produced no user-visible content: session=${session.id}`);
  }
  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      parts,
    },
  };
}
