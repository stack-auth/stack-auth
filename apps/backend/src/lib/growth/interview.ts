import { Prisma } from "@/generated/prisma/client";
import { GrowthPhaseStatus, GrowthRunStatus } from "@/generated/prisma/enums";
import type { Tenancy } from "@/lib/tenancies";
import { enqueueWorkflowEvent } from "@/lib/workflows/events";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { isGrowthInterviewReleased } from "./interview-release";
import { assertTriggerIsValid } from "./phases";
import { GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY } from "./phases";
import { createGrowthRunToken } from "./run-token";
import { GROWTH_EVENT_TYPES } from "./workflows";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";

/**
 * Read/write logic behind the internal/growth/interview* admin routes, kept out of the route files
 * the same way lib/growth/dashboard.ts backs the other internal/growth/* routes.
 *
 * The interview is HYBRID: the pre-generated question plan (GrowthInterviewQuestion rows) carries the
 * structured questions and their answers, while the conversational transcript (GrowthInterview
 * .messages, AI SDK UIMessages) carries the chat the customer actually sees. Answers are persisted
 * onto the question rows BEFORE anything is proxied to the Eve interview agent, so a mid-turn agent
 * failure can never lose an answer — see streamGrowthInterviewTurn.
 */

// How long one Eve interview turn may take end-to-end. A turn is a single short LLM exchange (react
// to the answer, present the next question), but it runs a full task-mode agent session on the Eve
// side, so this is generous rather than snappy.
const EVE_INTERVIEW_TURN_TIMEOUT_MS = 120_000;

// User-visible copy for the persist-then-proxy-fail path. The 502 (rather than a 5xx assertion
// error) is deliberate and load-bearing for the dashboard: the answer HAS been saved, and the client
// must be able to tell "your answer is safe, just retry the turn" apart from a real server bug.
const EVE_UNAVAILABLE_MESSAGE = "The interview assistant could not be reached. Your answer was saved — please try again in a moment.";

type LatestRunWithInterview = NonNullable<Awaited<ReturnType<typeof findLatestRunWithInterview>>>;

async function findLatestRunWithInterview(tenancy: Tenancy) {
  const latestRun = await globalPrismaClient.growthAnalysisRun.findFirst({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { interview: { include: { questions: { orderBy: { orderIndex: "asc" } } } } },
  });
  // A cancelled run is treated like no run at all, mirroring getGrowthStatusBody.
  return latestRun == null || latestRun.status === GrowthRunStatus.CANCELLED ? null : latestRun;
}

async function requireLatestRunWithInterview(tenancy: Tenancy, options?: { allowHeld?: boolean }): Promise<LatestRunWithInterview & { interview: NonNullable<LatestRunWithInterview["interview"]> }> {
  const run = await findLatestRunWithInterview(tenancy);
  if (run?.interview == null || (options?.allowHeld !== true && !isGrowthInterviewReleased(run.interview))) {
    // Also covers "no run at all": before the interview-questions phase saved a plan there is no
    // interview resource to show, and the dashboard treats the 404 as "not ready yet".
    throw new StatusError(404, "No interview exists for this project yet.");
  }
  // Object spread instead of a cast: the null check above is what narrows interview.
  return { ...run, interview: run.interview };
}

type StoredQuestionOption = { id: string, label: string, description: string | null };

/**
 * Parses the GrowthInterviewQuestion.options Json column back into typed form. The column is only
 * ever written from the validated machine-route bodies, so anything else means row corruption.
 */
function parseStoredQuestionOptions(json: Prisma.JsonValue): StoredQuestionOption[] {
  if (!Array.isArray(json)) {
    throw new HexclaveAssertionError("GrowthInterviewQuestion.options is not an array", { json });
  }
  return json.map((entry) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry) || typeof entry.id !== "string" || typeof entry.label !== "string") {
      throw new HexclaveAssertionError("GrowthInterviewQuestion.options entry has an unexpected shape", { entry });
    }
    return { id: entry.id, label: entry.label, description: typeof entry.description === "string" ? entry.description : null };
  });
}

/** Same contract as parseStoredQuestionOptions, for the answerOptionIds Json column. */
function parseStoredAnswerOptionIds(json: Prisma.JsonValue | null): string[] | null {
  if (json == null) return null;
  if (!Array.isArray(json)) {
    throw new HexclaveAssertionError("GrowthInterviewQuestion.answerOptionIds is not an array", { json });
  }
  return json.map((entry) => {
    if (typeof entry !== "string") {
      throw new HexclaveAssertionError("GrowthInterviewQuestion.answerOptionIds contains a non-string entry", { entry });
    }
    return entry;
  });
}

/** Parses GrowthInterview.messages (opaque UIMessage list, whole-list read/write only). */
function parseStoredMessages(json: Prisma.JsonValue | null): unknown[] {
  if (json == null) return [];
  if (!Array.isArray(json)) {
    throw new HexclaveAssertionError("GrowthInterview.messages is not an array", { json });
  }
  return json;
}

type InterviewQuestionRow = NonNullable<LatestRunWithInterview["interview"]>["questions"][number];

function questionToWire(question: InterviewQuestionRow) {
  return {
    question_key: question.questionKey,
    order_index: question.orderIndex,
    prompt: question.prompt,
    kind: question.kind,
    options: parseStoredQuestionOptions(question.options),
    allow_skip: question.allowSkip,
    origin: question.origin,
    answer_option_ids: parseStoredAnswerOptionIds(question.answerOptionIds),
    answer_free_text: question.answerFreeText,
    answered_at_millis: question.answeredAt == null ? null : question.answeredAt.getTime(),
  };
}

/** GET /internal/growth/interview — shape pinned by getGrowthInterview in the dashboard's growth-api.ts. */
export async function getGrowthInterviewBody(tenancy: Tenancy) {
  const run = await requireLatestRunWithInterview(tenancy);
  return {
    status: run.interview.status,
    questions: run.interview.questions.map(questionToWire),
    messages: parseStoredMessages(run.interview.messages),
  };
}

/** POST /internal/growth/interview/skip — ack returns the resulting interview status per the frozen contract. */
export async function skipGrowthInterview(tenancy: Tenancy): Promise<{ status: string }> {
  const run = await requireLatestRunWithInterview(tenancy);
  return await retryTransaction(globalPrismaClient, async (tx) => {
    const interview = await tx.growthInterview.findUnique({ where: { id: run.interview.id } })
      ?? throwErr(new HexclaveAssertionError("GrowthInterview row disappeared between read and skip — interviews are only deleted via run cascade, and active runs are never deleted.", { interviewId: run.interview.id }));
    if (interview.status === "skipped") {
      // Idempotent: skipping twice (e.g. a retried request) is not an error.
      return { status: "skipped" };
    }
    if (interview.status !== "pending" && interview.status !== "active") {
      throw new StatusError(400, `The interview is already ${interview.status} and can no longer be skipped.`);
    }
    await tx.growthInterview.update({
      where: { id: interview.id },
      data: { status: "skipped", completedAt: new Date() },
    });
    // Deliberately does NOT touch the run status: the orchestration tick treats a skipped
    // interview exactly like a completed one and owns the AWAITING_INTERVIEW -> COMPOSING_REPORT
    // flip (verified against lib/growth/orchestration.ts). The boundary event below starts the
    // workflow leg that drives that tick; it rides in the status-flip transaction (and only in the
    // actual flip path, so the idempotent re-skip above cannot double-fire it).
    await enqueueWorkflowEvent(tx, {
      tenancy: { id: tenancy.id },
      type: GROWTH_EVENT_TYPES.interviewFinished,
      payload: { growth_run_id: run.id },
    });
    return { status: "skipped" };
  });
}

/**
 * Throws away the current question plan and transcript and re-runs the `interview-questions` phase,
 * keeping every research finding from this run.
 *
 * This exists because the plan is generated once and then frozen (the machine route only replaces a
 * plan while nothing has been answered), so a plan the customer dislikes — or one produced by a
 * prompt we have since fixed — was previously only escapable by starting a whole new analysis run
 * and paying for website research, data analysis, and all four analysis topics again.
 *
 * Deliberately scoped to AWAITING_INTERVIEW only. Once the interview finishes, its answers have
 * already flowed into the report phase, so "retake" would have to invalidate and recompose the
 * report too; that is a bigger feature and refusing loudly beats half-doing it.
 */
export async function retakeGrowthInterview(tenancy: Tenancy, options?: { allowHeld?: boolean }): Promise<{ status: string, runId: string }> {
  const run = await requireLatestRunWithInterview(tenancy, options);
  if (run.status !== GrowthRunStatus.AWAITING_INTERVIEW) {
    throw new StatusError(400, "The interview can only be retaken while the analysis is waiting on it.");
  }
  await retryTransaction(globalPrismaClient, async (tx) => {
    // CAS on the run status rather than trusting the read above: the orchestration tick flips
    // AWAITING_INTERVIEW -> COMPOSING_REPORT as soon as it sees a completed/skipped interview, so a
    // retake racing that flip must lose rather than resurrect a run whose report is already being
    // written. Moving RUNNING <- AWAITING_INTERVIEW keeps the run inside ACTIVE_RUN_STATUSES, so the
    // one-active-run unique index cannot trip here (unlike the retry path, which revives a dead run).
    const claimed = await tx.growthAnalysisRun.updateMany({
      where: { id: run.id, status: GrowthRunStatus.AWAITING_INTERVIEW },
      data: { status: GrowthRunStatus.RUNNING, errorMessage: null },
    });
    if (claimed.count === 0) {
      throw new StatusError(400, "The interview can only be retaken while the analysis is waiting on it.");
    }
    // Questions cascade-delete from the interview row, but the row itself is reused so the run's
    // `interview` relation (which the transition step reads) never briefly disappears.
    await tx.growthInterviewQuestion.deleteMany({ where: { interviewId: run.interview.id } });
    await tx.growthInterview.update({
      where: { id: run.interview.id },
      data: { status: "pending", messages: Prisma.DbNull, completedAt: null, releasedAt: null, releasedByUserId: null },
    });
    // A full re-arm, not just status: the phase gets a fresh attempt budget (a retake is a new piece
    // of work, not a continuation of the old one) and the stale timestamps would otherwise make the
    // reaper treat it as a long-dead dispatch the moment it flips to PENDING.
    const rearmed = await tx.growthAnalysisPhase.updateMany({
      where: { runId: run.id, phaseKey: GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY },
      data: {
        status: GrowthPhaseStatus.PENDING,
        attempt: 0,
        dispatchedAt: null,
        startedAt: null,
        finishedAt: null,
        heartbeatAt: null,
        eveSessionId: null,
        errorMessage: null,
      },
    });
    if (rearmed.count !== 1) {
      throw new HexclaveAssertionError(`Growth run ${run.id} has no ${GROWTH_INTERVIEW_QUESTIONS_PHASE_KEY} phase row — run creation always creates one, so this should be impossible.`, { runId: run.id, rearmed: rearmed.count });
    }
    // The activation leg for this run exited when it reached AWAITING_INTERVIEW (a resting status),
    // and onConflict "skip" only dedupes against ACTIVE legs, so this reliably starts a new one.
    await enqueueWorkflowEvent(tx, {
      tenancy: { id: tenancy.id },
      type: GROWTH_EVENT_TYPES.analysisRunActivated,
      payload: { growth_run_id: run.id, trigger: assertTriggerIsValid(run.trigger) },
    });
  });
  return { status: "pending", runId: run.id };
}

export type GrowthInterviewAnswerInput = {
  orderIndex: number,
  optionIds: string[] | undefined,
  freeText: string | undefined,
  skipped: boolean | undefined,
};

/**
 * Validates and persists one answer onto the question row at `orderIndex`. Runs BEFORE the Eve
 * proxy call so the answer survives any downstream failure. Re-answering an already-answered
 * question overwrites (the customer may revise, and retried stream requests must not 400).
 */
async function persistGrowthInterviewAnswer(interviewId: string, interviewStatus: string, answer: GrowthInterviewAnswerInput): Promise<void> {
  await retryTransaction(globalPrismaClient, async (tx) => {
    const question = await tx.growthInterviewQuestion.findUnique({
      where: { interviewId_orderIndex: { interviewId, orderIndex: answer.orderIndex } },
    });
    if (question == null) {
      throw new StatusError(400, `There is no interview question at order_index ${answer.orderIndex}.`);
    }
    const optionIds = answer.optionIds ?? [];
    const freeText = answer.freeText?.trim() ?? null;
    if (answer.skipped === true) {
      if (!question.allowSkip) {
        throw new StatusError(400, "This interview question cannot be skipped.");
      }
      if (optionIds.length > 0 || freeText != null) {
        throw new StatusError(400, "A skipped answer must not carry option_ids or free_text.");
      }
    } else {
      if (optionIds.length === 0 && (freeText == null || freeText.length === 0)) {
        throw new StatusError(400, "An answer must select at least one option, provide free_text, or set skipped.");
      }
      const validOptionIds = new Set(parseStoredQuestionOptions(question.options).map((option) => option.id));
      const unknownOptionId = optionIds.find((optionId) => !validOptionIds.has(optionId));
      if (unknownOptionId != null) {
        throw new StatusError(400, `Unknown option id for this question: ${unknownOptionId}`);
      }
      if (question.kind === "single" && optionIds.length > 1) {
        throw new StatusError(400, "This question accepts a single option.");
      }
      if (optionIds.includes("other") && (freeText == null || freeText.length === 0)) {
        throw new StatusError(400, "Selecting Other requires a written answer.");
      }
    }
    await tx.growthInterviewQuestion.update({
      where: { id: question.id },
      data: {
        answerOptionIds: optionIds.length === 0 ? Prisma.JsonNull : optionIds,
        answerFreeText: answer.skipped === true ? null : freeText,
        answeredAt: new Date(),
      },
    });
    if (interviewStatus === "pending") {
      // First answer flips the interview live. Guarded on the current status so a concurrent
      // completion/skip is not clobbered back to active.
      await tx.growthInterview.updateMany({
        where: { id: interviewId, status: "pending" },
        data: { status: "active" },
      });
    }
  });
}

/**
 * Builds the user-side UIMessage for an answer. The backend (not Eve) authors the transcript's user
 * messages so the persisted chat history is deterministic and cannot be spoofed or dropped by the
 * agent.
 */
function buildAnswerUserMessage(question: InterviewQuestionRow, answer: GrowthInterviewAnswerInput): unknown {
  const options = parseStoredQuestionOptions(question.options);
  const optionLabels = (answer.optionIds ?? []).map((optionId) => options.find((option) => option.id === optionId)?.label ?? optionId);
  const fragments = answer.skipped === true
    ? ["(skipped this question)"]
    : [...optionLabels, ...answer.freeText == null || answer.freeText.length === 0 ? [] : [answer.freeText]];
  return {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: fragments.join("\n") }],
  };
}

// Read per call, never at module scope: the e2e suite points this at a mock server whose port is
// only known after the backend module graph has already been loaded (same note as engine.ts).
function getGrowthEveBaseUrl(): string {
  return getEnvVariable("HEXCLAVE_GROWTH_EVE_URL");
}

type EveAssistantMessage = { id: string, role: "assistant", parts: Record<string, unknown>[] };

/**
 * Narrows the Eve /interview response body. Anything malformed is treated exactly like an
 * unreachable Eve (502 + captureError), never surfaced to the user: from the customer's point of
 * view a garbled agent IS an unavailable agent — and the already-persisted answer stays safe.
 */
function parseEveInterviewResponse(json: unknown): EveAssistantMessage | null {
  if (typeof json !== "object" || json == null || !("message" in json)) return null;
  const message = json.message;
  if (typeof message !== "object" || message == null || Array.isArray(message)) return null;
  if (!("id" in message) || typeof message.id !== "string") return null;
  if (!("role" in message) || message.role !== "assistant") return null;
  if (!("parts" in message) || !Array.isArray(message.parts)) return null;
  const parts: Record<string, unknown>[] = [];
  for (const part of message.parts) {
    if (typeof part !== "object" || part == null || Array.isArray(part) || typeof (part as Record<string, unknown>).type !== "string") return null;
    // The element type of an unknown[] needs one narrowing step; the checks above make this shape-safe.
    parts.push(part as Record<string, unknown>);
  }
  return { id: message.id, role: "assistant", parts };
}

/**
 * Converts the completed assistant UIMessage into the exact chunk sequence AI SDK v6's `useChat`
 * expects for a single-shot message ("start" -> per-part chunks -> "finish"). Only text and tool
 * parts are re-emitted; anything else (reasoning, files, ...) is dropped from the stream but kept in
 * the persisted transcript, so nothing is lost if the dashboard later learns to render it.
 */
function chunksFromAssistantMessage(message: EveAssistantMessage): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: message.id },
    { type: "start-step" },
  ];
  for (const part of message.parts) {
    const partType = typeof part.type === "string" ? part.type : throwErr("unreachable: parseEveInterviewResponse validated part.type");
    if (partType === "text" && typeof part.text === "string") {
      const textId = randomUUID();
      chunks.push({ type: "text-start", id: textId });
      chunks.push({ type: "text-delta", id: textId, delta: part.text });
      chunks.push({ type: "text-end", id: textId });
    } else if (partType.startsWith("tool-") && typeof part.toolCallId === "string") {
      const toolName = partType.slice("tool-".length);
      chunks.push({ type: "tool-input-available", toolCallId: part.toolCallId, toolName, input: part.input ?? null });
      if (part.state === "output-error" && typeof part.errorText === "string") {
        chunks.push({ type: "tool-output-error", toolCallId: part.toolCallId, errorText: part.errorText });
      } else if (part.state === "output-available") {
        chunks.push({ type: "tool-output-available", toolCallId: part.toolCallId, output: part.output ?? null });
      }
      // "input-available" (no result) is left as-is: the dashboard renders the question card from
      // the input alone; present-interview-question's output is semantically meaningless anyway.
    }
  }
  chunks.push({ type: "finish-step" });
  chunks.push({ type: "finish" });
  return chunks;
}

/**
 * POST /internal/growth/interview/stream — one interview turn.
 *
 * 1. Requires the run to be AWAITING_INTERVIEW and the interview to be open (pending/active).
 * 2. If an answer is present, persists it onto the question plan FIRST (answer-first persistence).
 * 3. Proxies the turn to Eve's /interview channel route and persists the updated transcript.
 * 4. Responds with an AI SDK UI message chunk stream of the assistant's turn.
 *
 * STREAMING ADAPTATION (v1, deliberate): Eve's durable session event stream is NDJSON of eve-shaped
 * events, not AI SDK UI chunks, and the interview agent runs a whole task-mode session per turn. v1
 * therefore has Eve wait for the turn and return the completed assistant UIMessage as JSON; this
 * function then synthesizes a valid single-shot UI message chunk stream from it. Interview turns are
 * short, so perceived latency is acceptable. TODO(growth): true incremental streaming by adapting
 * eve `message.appended` / `actions.requested` events into UI chunks in this proxy.
 */
export async function streamGrowthInterviewTurn(tenancy: Tenancy, options: { answer: GrowthInterviewAnswerInput | undefined }): Promise<Response> {
  const run = await requireLatestRunWithInterview(tenancy);
  if (run.status !== GrowthRunStatus.AWAITING_INTERVIEW) {
    throw new StatusError(400, "The interview is not currently awaiting answers.");
  }
  if (run.interview.status !== "pending" && run.interview.status !== "active") {
    throw new StatusError(400, `The interview is already ${run.interview.status}.`);
  }

  let answeredQuestion: InterviewQuestionRow | undefined;
  if (options.answer != null) {
    const answer = options.answer;
    await persistGrowthInterviewAnswer(run.interview.id, run.interview.status, answer);
    answeredQuestion = run.interview.questions.find((question) => question.orderIndex === answer.orderIndex)
      ?? throwErr(new HexclaveAssertionError("persistGrowthInterviewAnswer succeeded for an order_index missing from the loaded plan — the plan was loaded in this request, so this should be impossible.", { orderIndex: answer.orderIndex }));
  }

  // ── Everything below is best-effort: the answer above is already durable. ──

  const storedTranscript = parseStoredMessages(run.interview.messages);
  const sentTranscript = answeredQuestion == null || options.answer == null
    ? storedTranscript
    : [...storedTranscript, buildAnswerUserMessage(answeredQuestion, options.answer)];

  // Questions ride along with answers applied in-memory (the DB write above is not re-read; the
  // answer input is authoritative for this request).
  const questionsPayload = run.interview.questions.map((question) => ({
    question_id: question.id,
    ...questionToWire(question),
    ...options.answer != null && question.orderIndex === options.answer.orderIndex ? {
      answer_option_ids: options.answer.optionIds ?? null,
      answer_free_text: options.answer.skipped === true ? null : options.answer.freeText ?? null,
      answered_at_millis: Date.now(),
    } : {},
  }));

  let assistantMessage: EveAssistantMessage;
  try {
    // Channel routes live at the server root of the Eve app; the path is a code constant.
    const url = getGrowthEveBaseUrl().replace(/\/+$/, "") + "/interview";
    // The interview is a conversation with a human about their business, so its run token carries
    // ONLY the growth-API capability — no path from here can vend an ad-platform credential (see the
    // capability grant table in run-token.ts). It rides in the BODY, never the Authorization header,
    // which authenticates the hop with the shared machine secret.
    const agentToken = await createGrowthRunToken({
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      tenancyId: tenancy.id,
      session: { sessionKind: "interview_turn", runId: run.id },
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${getEnvVariable("HEXCLAVE_GROWTH_AGENT_API_SECRET")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        project_id: tenancy.project.id,
        branch_id: tenancy.branchId,
        run_id: run.id,
        transcript: sentTranscript,
        questions: questionsPayload,
        agent_token: agentToken,
      }),
      signal: AbortSignal.timeout(EVE_INTERVIEW_TURN_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new HexclaveAssertionError(`Growth Eve interview turn failed with status ${response.status}`, { status: response.status, responseText: await response.text() });
    }
    assistantMessage = parseEveInterviewResponse(await response.json())
      ?? throwErr(new HexclaveAssertionError("Growth Eve interview turn returned a malformed body", { runId: run.id }));
  } catch (error) {
    captureError("growth-interview", new HexclaveAssertionError(`Growth interview turn proxy failed for run ${run.id}`, { cause: error, runId: run.id }));
    // 502 with a safe message (not a masked 500): the client needs to know the answer was saved and
    // the turn is retryable. This is a deliberate exception to the "StatusError is 4xx" rule.
    throw new StatusError(502, EVE_UNAVAILABLE_MESSAGE);
  }

  // Transcript is whole-list write-only; last-writer-wins is fine because the dashboard runs one
  // interview turn at a time. JSON round-trip guarantees a Prisma-safe plain-JSON value.
  await globalPrismaClient.growthInterview.update({
    where: { id: run.interview.id },
    data: { messages: JSON.parse(JSON.stringify([...sentTranscript, assistantMessage])) },
  });

  const chunks = chunksFromAssistantMessage(assistantMessage);
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        for (const chunk of chunks) {
          writer.write(chunk);
        }
      },
    }),
  });
}
