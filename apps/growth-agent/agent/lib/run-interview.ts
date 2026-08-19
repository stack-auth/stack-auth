import type { SendFn } from "eve/channels";
import { buildGrowthSessionAuth, GROWTH_INTERVIEW_PHASE_KEY } from "#lib/run-context.ts";
import { followSessionEvents } from "#lib/session-stream.ts";
import type { GrowthAgentTokenRef, GrowthProjectRef } from "#lib/types.ts";
import { PLAIN_LANGUAGE_RULE } from "#lib/writing-style.ts";
import { FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH } from "#lib/interview-question.ts";


/** Inbound body of POST /interview (backend -> agent). */
export type InterviewTurnRequest = GrowthProjectRef & GrowthAgentTokenRef & {
  readonly run_id: string,
  /** AI SDK UIMessages, opaque to this agent beyond being prompt context. */
  readonly transcript: readonly unknown[],
  /** Question plan with answers, in the backend's wire shape; opaque prompt context here. */
  readonly questions: readonly unknown[],
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

export type InterviewTurnResult = {
  readonly message: AssistantUiMessage,
};


const PROJECTED_INTERVIEW_TOOLS = new Set(["present-interview-question", "record-adaptive-question", "complete-interview"]);


const TURN_ENDING_INTERVIEW_TOOLS = new Set(["present-interview-question", "complete-interview"]);


const MAX_INTERVIEW_TURN_MS = 5 * 60 * 1000;

function buildInterviewTurnPrompt(input: InterviewTurnRequest): string {
  return [
    `You are interviewing a founder for growth analysis run ${input.run_id} of project ${input.project_id} (branch ${input.branch_id}). This is one turn of that interview.`,
    "",
    "The person answering is the founder or operator of the product this run analysed. They built it. Every question is about THEIR product and THEIR customers — never about Hexclave, which is only the platform running this analysis.",
    "",
    "The question plan with all answers so far (answered_at_millis != null means answered; the founder's latest answer is the most recently answered entry):",
    "```json",
    JSON.stringify(input.questions, null, 2),
    "```",
    "",
    "The conversation transcript so far (AI SDK UIMessages; may be empty on the opening turn):",
    "```json",
    JSON.stringify(input.transcript, null, 2),
    "```",
    "",
    "Run exactly ONE interview turn:",
    `1. If any question remains unanswered, present the NEXT unanswered one. On the opening turn, write one short introductory sentence; later turns may use one brief reaction of at most 10 words. Then call \`present-interview-question\` exactly once. Preserve the stored ids, kind, options, and flags. Preserve both the evidence anchor and focused question. If a legacy prompt exceeds ${FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH} characters, shorten only \`text\` while retaining both parts and its meaning. Preserve its final Other option and set allow_free_text to true.`,
    "2. If the founder's latest answer makes ONE follow-up worth asking that is not in the plan, you may first persist it with `record-adaptive-question` (which returns its question_id and order_index) and then present THAT question instead — never present a question that was not persisted.",
    "3. If every question is answered, call `complete-interview` exactly once and write a brief closing message thanking them.",
    "",
    "Rules:",
    "- Present at most one question per turn, then stop. Never answer questions yourself.",
    "- Never explain or lengthen the stored question. Apart from shortening a legacy prompt to the limit above, preserve its evidence anchor, focused question, and meaning exactly.",
    "- The founder answers through the interview UI, not in this session — never wait for a reply.",
    "- Do not call any tools other than the three interview tools named above.",
    "- Your text messages are shown to the founder verbatim: keep them short, warm, and free of internal jargon (no run ids, tool names, or JSON).",
    `- ${PLAIN_LANGUAGE_RULE}`,
    "- Your lead-in must NOT describe or refer to the question card ('the question above', 'presented in the interface', 'select an option below'). Write only the conversational lead-in; the card renders itself.",
    "- Write the lead-in exactly once per turn. Do not restate your introduction on later turns.",
    "- Write your lead-in BEFORE calling `present-interview-question`, and write NOTHING after the call. The card is the last thing in the turn; any text after it appears underneath the unanswered question and reads as a reply to an answer that does not exist yet. End the turn as soon as the tool call returns.",
  ].join("\n");
}


export async function executeInterviewTurn(input: InterviewTurnRequest, helpers: { readonly send: SendFn }): Promise<InterviewTurnResult> {
  const session = await helpers.send(buildInterviewTurnPrompt(input), {
    auth: buildGrowthSessionAuth({
      project_id: input.project_id,
      branch_id: input.branch_id,
      run_id: input.run_id,
      phase_key: GROWTH_INTERVIEW_PHASE_KEY,
      finding_source: "chat",
      agent_token: input.agent_token,
    }),
    continuationToken: `interview:${input.run_id}:turn:${input.transcript.length}`,
    mode: "task",
    title: `Growth interview turn (run ${input.run_id})`,
  });

  const parts: AssistantUiMessage["parts"] = [];
  const toolPartsByCallId = new Map<string, AssistantToolPart>();
  const toolNamesByCallId = new Map<string, string>();
  let cancelledAfterTurnEndingTool = false;
  const seenTextParts = new Set<string>();

  // This turn ends by cancelling the session itself, and its exits (`turn.cancelled`, or the
  // `session.waiting` that follows it) settle the turn but not the session — so without this the
  // follower would fire a second, redundant cancel on every single turn.
  collect: for await (const event of followSessionEvents({
    session,
    label: "Interview turn",
    maxSessionMs: MAX_INTERVIEW_TURN_MS,
    isAlreadyStopped: () => cancelledAfterTurnEndingTool,
  })) {
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
          if (action.kind !== "tool-call" || !PROJECTED_INTERVIEW_TOOLS.has(action.toolName)) continue;
          const part: AssistantToolPart = {
            type: `tool-${action.toolName}`,
            toolCallId: action.callId,
            state: "input-available",
            input: action.input,
          };
          parts.push(part);
          toolPartsByCallId.set(action.callId, part);
          toolNamesByCallId.set(action.callId, action.toolName);
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
          if (!cancelledAfterTurnEndingTool && TURN_ENDING_INTERVIEW_TOOLS.has(toolNamesByCallId.get(result.callId) ?? "")) {
            await session.cancel();
            // Set only once the cancel landed. The flag doubles as the follower's `isAlreadyStopped`
            // answer, and a cancel that threw leaves the session running — that case must fall
            // through to the follower's cleanup cancel rather than silently opting out of it.
            cancelledAfterTurnEndingTool = true;
          }
        } else {
          part.state = "output-error";
          part.errorText = event.data.error?.message ?? "Tool call failed";
        }
        break;
      }
      case "turn.cancelled": {
        break collect;
      }
      case "session.completed": {
        break collect;
      }
      case "session.failed": {
        throw new Error(`Interview turn session failed: session=${session.id} code=${event.data.code} message=${event.data.message}`);
      }
      case "session.waiting": {
        if (cancelledAfterTurnEndingTool) break collect;
        throw new Error(`Interview turn session parked waiting for input in task mode: session=${session.id}`);
      }
      default: {
        break;
      }
    }
  }

  if (parts.length === 0) {
    throw new Error(`Interview turn produced no user-visible content: session=${session.id}`);
  }
  return {
    message: {
      id: crypto.randomUUID(),
      role: "assistant",
      parts,
    },
  };
}
