import type { SendFn } from "eve/channels";
import { buildGrowthSessionAuth, GROWTH_INTERVIEW_PHASE_KEY } from "#lib/run-context.ts";
import type { GrowthAgentTokenRef, GrowthProjectRef } from "#lib/types.ts";
import { PLAIN_LANGUAGE_RULE } from "#lib/writing-style.ts";
import { FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH } from "#lib/interview-question.ts";

/**
 * One turn of the hybrid customer interview, dispatched synchronously from the
 * `/interview` channel route (the backend awaits the completed turn — see the
 * route for the v1 non-streamed rationale).
 *
 * DESIGN DECISION — root-handled, not delegated to a subagent: eve@0.27.0 runs
 * declared subagents as child *workflow* sessions (`subagent.called` +
 * dispatch-workflow-runtime-actions in execution/turn-workflow); the
 * `subagent.event` child-event mirroring is only guaranteed for inline
 * subagents. That means a turn delegated to an `interview-generator` subagent
 * could complete without the parent event stream ever carrying the child's
 * `actions.requested` events — and those tool inputs are exactly what this
 * module must project into the assistant UIMessage (the dashboard renders the
 * question cards from `tool-present-interview-question` parts). Handling the
 * turn on the root agent keeps every event we need on the one stream
 * `session.getEventStream()` is documented to expose. The interview-only tools
 * therefore live in `agent/tools/` guarded by readGrowthInterviewContext, and
 * no `interview-generator` subagent is declared in v1.
 */

/** Inbound body of POST /interview (backend -> agent). */
export type InterviewTurnRequest = GrowthProjectRef & GrowthAgentTokenRef & {
  readonly run_id: string,
  /** AI SDK UIMessages, opaque to this agent beyond being prompt context. */
  readonly transcript: readonly unknown[],
  /** Question plan with answers, in the backend's wire shape; opaque prompt context here. */
  readonly questions: readonly unknown[],
};

/**
 * Minimal AI SDK v6 UIMessage part shapes this module emits. Only text and
 * interview tool parts are produced; the backend proxy passes them through to
 * the dashboard's useChat verbatim, so these shapes are wire contract.
 */
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

/**
 * The interview-only tools whose calls are projected into the assistant
 * message. Any other tool the model happens to call (e.g. a stray sql-query)
 * is deliberately NOT projected: the dashboard only knows how to render text
 * and these tool parts, and internal tool traffic must not leak into the
 * customer-facing transcript.
 */
const PROJECTED_INTERVIEW_TOOLS = new Set(["present-interview-question", "record-adaptive-question", "complete-interview"]);

/**
 * Tools whose successful result means the turn has done its job, so the session is cancelled the
 * moment one returns.
 *
 * WHY THIS EXISTS. `present-interview-question` is a semantically fake tool: the dashboard renders
 * the card from the tool INPUT and the founder answers through a separate request, so `execute`
 * returns `{ presented: true }` and nothing else happens. Nothing in that result tells the model the
 * turn is over. On 2026-08-07 a model read `{ presented: true }`, had no answer to react to, and
 * simply called the tool again with the identical question — 119 times over 31 minutes, 257 prompt
 * messages, 6.6M input tokens and $1.37, for one question card. Every existing guard failed to stop
 * it: the backend's 120s budget and this file's 5-minute cap both abandon the CALLER without
 * cancelling the eve session, so it kept running long after the customer saw a 502.
 *
 * The prompt already says "write NOTHING after the call" and "End the turn as soon as the tool call
 * returns", so cancelling here enforces what the prompt asks for rather than cutting a turn short —
 * and it also guarantees the no-prose-below-the-card property that rule exists to protect.
 *
 * `record-adaptive-question` is deliberately NOT here: the model persists a follow-up and then
 * presents it, so its result is mid-turn.
 */
const TURN_ENDING_INTERVIEW_TOOLS = new Set(["present-interview-question", "complete-interview"]);


/**
 * Upper bound on one interview turn. A turn is a single short exchange; this
 * cap only converts "stuck forever" into an error the backend can surface as
 * its retryable 502 (mirrors MAX_AGENT_SESSION_MS in run-analysis-phase.ts,
 * scaled down to conversational latency).
 */
const MAX_INTERVIEW_TURN_MS = 5 * 60 * 1000;

function buildInterviewTurnPrompt(input: InterviewTurnRequest): string {
  return [
    `You are interviewing a founder for growth analysis run ${input.run_id} of project ${input.project_id} (branch ${input.branch_id}). This is one turn of that interview.`,
    "",
    // Deliberately spelled out: the phrase "customer interview" used to live here and the model
    // read it as the growth term of art (interview a buyer about why they bought), casting the
    // founder as a Hexclave customer and asking why they picked us over competing vendors.
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
    // The question card is rendered from the tool part itself, so any prose describing it
    // duplicates what the reader already sees and breaks the conversational illusion.
    "- Your lead-in must NOT describe or refer to the question card ('the question above', 'presented in the interface', 'select an option below'). Write only the conversational lead-in; the card renders itself.",
    "- Write the lead-in exactly once per turn. Do not restate your introduction on later turns.",
    // The transcript renders text and tool parts in the order the model emitted them, so anything
    // written after the tool call lands BELOW the question card — where it reads as a reply to a
    // question the reader has not answered yet ("Great — I've started the interview" under an
    // unanswered card). The lead-in is the only prose a question turn may contain.
    "- Write your lead-in BEFORE calling `present-interview-question`, and write NOTHING after the call. The card is the last thing in the turn; any text after it appears underneath the unanswered question and reads as a reply to an answer that does not exist yet. End the turn as soon as the tool call returns.",
  ].join("\n");
}

/**
 * Runs the interview-turn agent session and assembles the assistant UIMessage
 * from the session's durable event stream:
 *   - `message.completed`  -> text part (full step text; deltas are skipped since v1 does not stream)
 *   - `actions.requested`  -> tool part (state input-available) for projected interview tools
 *   - `action.result`      -> resolves the matching tool part to output-available / output-error
 * Arrival order is chronological, so pushing parts as their first event
 * arrives reproduces the model's text/tool interleaving.
 */
export async function executeInterviewTurn(input: InterviewTurnRequest, helpers: { readonly send: SendFn }): Promise<InterviewTurnResult> {
  const session = await helpers.send(buildInterviewTurnPrompt(input), {
    auth: buildGrowthSessionAuth({
      project_id: input.project_id,
      branch_id: input.branch_id,
      run_id: input.run_id,
      phase_key: GROWTH_INTERVIEW_PHASE_KEY,
      // If the model saves a finding mid-interview (it is told not to, but the tool exists on the
      // root surface), "chat" is the honest source bucket for customer-conversation-derived data.
      finding_source: "chat",
      agent_token: input.agent_token,
    }),
    // Turn count in the token keeps every turn its own task session: interview state lives in the
    // backend (plan + transcript), so sessions are stateless and never resumed.
    continuationToken: `interview:${input.run_id}:turn:${input.transcript.length}`,
    mode: "task",
    title: `Growth interview turn (run ${input.run_id})`,
  });

  const parts: AssistantUiMessage["parts"] = [];
  const toolPartsByCallId = new Map<string, AssistantToolPart>();
  const toolNamesByCallId = new Map<string, string>();
  // Set once we ask eve to cancel, so the `session.waiting` that confirms the cancellation is read
  // as the expected end of the turn rather than the task-mode-parked failure it means otherwise.
  let cancelledAfterTurnEndingTool = false;
  // Text already projected into `parts`, so a later step's repeated message doesn't render twice.
  const seenTextParts = new Set<string>();

  const stream = await session.getEventStream({ startIndex: 0 });
  const reader = stream.getReader();
  // Resolve-only timer raced against every read; mirrors runAgentSession in run-analysis-phase.ts
  // (kept local because that helper is module-private and phase-lifecycle-shaped).
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutTimer = setTimeout(() => resolve("timeout"), MAX_INTERVIEW_TURN_MS);
    timeoutTimer.unref();
  });
  try {
    collect: while (true) {
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult === "timeout") {
        await reader.cancel();
        // Cancel the SESSION, not just our reader. Dropping the stream only stops us listening —
        // on 2026-08-07 a looping turn outlived this timeout by 26 minutes and kept billing,
        // because nothing ever told eve to stop.
        //
        // A failed cancel is folded into the thrown message rather than swallowed or rethrown: the
        // timeout is the diagnosis the caller needs, but "we timed out AND could not stop the
        // session" is materially worse news than the timeout alone and must not be lost.
        const cancelError = await session.cancel().then(() => null, (error: unknown) => error);
        const cancelNote = cancelError == null
          ? ""
          : ` (cancelling the session also failed: ${cancelError instanceof Error ? cancelError.message : String(cancelError)})`;
        throw new Error(`Interview turn timed out: session=${session.id}${cancelNote}`);
      }
      const { done, value: event } = readResult;
      if (done) {
        throw new Error(`Interview turn event stream ended without a terminal event: session=${session.id}`);
      }
      switch (event.type) {
        case "message.completed": {
          if (event.data.message != null && event.data.message.length > 0) {
            // Skip text we have already projected. `message.completed` fires once per STEP, and a
            // turn that calls a tool has at least two steps whose completed message repeats the
            // prose written before the call — projecting both rendered the lead-in twice, once
            // above the question card and once below it (observed 2026-08-06). Exact-string
            // dedupe is safe here because the prompt requires the lead-in be written exactly once
            // per turn, so a genuine repeat of the same sentence is a model error either way.
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
            // The turn's deliverable now exists. Cancel rather than `break collect`: breaking would
            // only stop US reading while the model kept generating (and billing) unattended, which
            // is exactly how the 2026-08-07 runaway survived both timeouts. We keep reading until
            // eve confirms, so any prose the model already emitted still lands in `parts`.
            if (!cancelledAfterTurnEndingTool && TURN_ENDING_INTERVIEW_TOOLS.has(toolNamesByCallId.get(result.callId) ?? "")) {
              cancelledAfterTurnEndingTool = true;
              await session.cancel();
            }
          } else {
            part.state = "output-error";
            part.errorText = event.data.error?.message ?? "Tool call failed";
          }
          break;
        }
        case "turn.cancelled": {
          // Our own cancellation landing. Anything else cancelling this turn is equally terminal —
          // there is no more model output coming either way.
          break collect;
        }
        case "session.completed": {
          break collect;
        }
        case "session.failed": {
          throw new Error(`Interview turn session failed: session=${session.id} code=${event.data.code} message=${event.data.message}`);
        }
        case "session.waiting": {
          // eve documents `turn.cancelled` followed by `session.waiting` as the confirmation of a
          // cancel request, so after we cancel this is the expected end of the turn, not a fault.
          if (cancelledAfterTurnEndingTool) break collect;
          // Task mode should never park otherwise; treat it as a failure rather than hanging to the timeout.
          throw new Error(`Interview turn session parked waiting for input in task mode: session=${session.id}`);
        }
        default: {
          // Progress events (turn/step/deltas/...) — keep waiting.
          break;
        }
      }
    }
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    reader.releaseLock();
  }

  if (parts.length === 0) {
    // An empty assistant turn would render as a blank chat bubble; surface it as a failure so the
    // backend returns its retryable 502 instead of persisting a broken transcript.
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
