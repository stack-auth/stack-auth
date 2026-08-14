"use client";

import { sendInternalAdminRequest } from "@/lib/hexclave-app-internals";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessageChunk } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { GrowthApiError } from "./growth-api";
import { GROWTH_DEMO_NOW_MILLIS } from "./growth-demo-data";

/**
 * Client-side logic for the freeform growth chat page, mirroring the structure of
 * growth-interview-chat.ts: pure, unit-tested helpers (message folding, tool-card derivation, demo
 * fixtures) plus fetchers for the two conversations GETs, wired together by the React hook at the
 * bottom so the page components stay declarative.
 *
 * The wire is the same one the interview uses: the POST /internal/growth/chat response is an AI SDK
 * v6 UI-message-chunk SSE stream (single-shot synthesized on the backend), and stored transcripts
 * are opaque UIMessages that this module narrows just far enough to render — text parts, the three
 * artifact-creating tool parts, and the `data-growth-conversation` data part that carries the
 * authoritative conversation id (the x-growth-conversation-id header is NOT exposed cross-origin,
 * see the backend's streamGrowthChatTurn). Unknown part types are skipped silently by design so the
 * agent can grow new part types without breaking old dashboards.
 */

// The conversation-id data part the backend injects as the first chunk after "start" (and which,
// being non-transient, also lands in the persisted assistant message's parts).
export const GROWTH_CHAT_CONVERSATION_DATA_PART_TYPE = "data-growth-conversation";

// The artifact-creating tools the Eve chat agent may call (data-tool traffic is filtered out on the
// Eve side, so these are the only tool parts a growth chat transcript carries). Names are pinned by
// the backend's chat wire contract (see apps/backend/src/lib/growth/chat.test.ts).
// "create-scheduled-task" is no longer emitted (scheduled tasks migrated to workflows attached to
// action items), but stays renderable so stored transcripts from before the migration keep working.
export const GROWTH_CHAT_TOOL_KINDS = ["create-action-item", "create-scheduled-task", "save-finding"] as const;
export type GrowthChatToolKind = typeof GROWTH_CHAT_TOOL_KINDS[number];

// -------------------------------------------------- view models --------------------------------------------------

export type GrowthChatConversationSummary = {
  id: string,
  title: string | null,
  createdAtMillis: number,
  updatedAtMillis: number,
};

export type GrowthChatToolCard = {
  kind: GrowthChatToolKind,
  /** A human-readable subject pulled from the tool input (title/summary), when present. */
  label: string | null,
  /** True when the tool part recorded an execution error — the artifact was NOT created. */
  errored: boolean,
  /** The created action item's id (create-action-item with an id-carrying output only). */
  createdActionItemId: string | null,
  /**
   * True when the create-action-item input carried an attached `workflow` — the card then reads
   * "proposed automation" and points at the review-and-activate flow instead of a plain action.
   */
  hasWorkflow: boolean,
};

export type GrowthChatTranscriptEntry =
  | { type: "text", id: string, role: "user" | "assistant", text: string }
  | { type: "tool", id: string, card: GrowthChatToolCard };

// -------------------------------------------------- pure helpers --------------------------------------------------

const uiMessageLikeSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  parts: z.array(z.unknown()),
}).passthrough();

const partTypeSchema = z.object({ type: z.string() }).passthrough();
const textPartSchema = z.object({ text: z.string() }).passthrough();
const conversationDataPartSchema = z.object({ data: z.object({ conversation_id: z.string() }).passthrough() }).passthrough();
const toolPartSchema = z.object({
  toolCallId: z.string(),
  state: z.string().optional(),
  input: z.unknown(),
  output: z.unknown(),
  errorText: z.string().optional(),
}).passthrough();

/** Best-effort subject line for a tool card: the input's `title`, falling back to its `summary`. */
function deriveToolLabel(input: unknown): string | null {
  const parsed = z.object({ title: z.string().optional(), summary: z.string().optional() }).passthrough().safeParse(input);
  if (!parsed.success) return null;
  const label = parsed.data.title ?? parsed.data.summary ?? null;
  return label != null && label.trim().length > 0 ? label : null;
}

/** Narrows one `tool-…` part (of a known artifact tool) to a renderable card; null if malformed. */
export function parseGrowthChatToolPart(kind: GrowthChatToolKind, part: unknown): GrowthChatToolCard | null {
  const parsed = toolPartSchema.safeParse(part);
  if (!parsed.success) return null;
  const errored = parsed.data.state === "output-error";
  let createdActionItemId: string | null = null;
  let hasWorkflow = false;
  if (kind === "create-action-item") {
    if (parsed.data.state === "output-available") {
      // The backend route answers { action_item_id }; `id` is kept as a fallback because older
      // stored transcripts (and the pinned chat wire test fixtures) used that shape.
      const output = z.object({ id: z.string().optional(), action_item_id: z.string().optional() }).passthrough().safeParse(parsed.data.output);
      if (output.success) createdActionItemId = output.data.action_item_id ?? output.data.id ?? null;
    }
    // The tool INPUT is the authoritative signal for an attached automation: the agent passes the
    // whole workflow spec there, and the output ack deliberately carries only the item id.
    const input = z.object({ workflow: z.unknown().optional() }).passthrough().safeParse(parsed.data.input);
    hasWorkflow = input.success && input.data.workflow != null;
  }
  return { kind, label: deriveToolLabel(parsed.data.input), errored, createdActionItemId, hasWorkflow };
}

/**
 * Converts one opaque UIMessage into transcript entries, also surfacing the conversation id if the
 * message carries a `data-growth-conversation` part (streamed turns and reloaded assistant messages
 * both do). Renderable-but-broken content is returned in `malformed` so the caller can report it
 * loudly; genuinely unknown part types are skipped silently by design (see the module comment).
 */
export function growthChatUiMessageToEntries(message: unknown, fallbackMessageId: string): {
  entries: GrowthChatTranscriptEntry[],
  conversationId: string | null,
  malformed: unknown[],
} {
  const parsed = uiMessageLikeSchema.safeParse(message);
  if (!parsed.success) return { entries: [], conversationId: null, malformed: [message] };
  const role = parsed.data.role;
  if (role !== "user" && role !== "assistant") return { entries: [], conversationId: null, malformed: [message] };
  const messageId = parsed.data.id ?? fallbackMessageId;
  const entries: GrowthChatTranscriptEntry[] = [];
  const malformed: unknown[] = [];
  let conversationId: string | null = null;
  parsed.data.parts.forEach((part, index) => {
    const entryId = `${messageId}:${index}`;
    const typed = partTypeSchema.safeParse(part);
    if (!typed.success) {
      malformed.push(part);
      return;
    }
    if (typed.data.type === "text") {
      const textPart = textPartSchema.safeParse(part);
      if (!textPart.success) {
        malformed.push(part);
        return;
      }
      if (textPart.data.text.length > 0) entries.push({ type: "text", id: entryId, role, text: textPart.data.text });
      return;
    }
    if (typed.data.type === GROWTH_CHAT_CONVERSATION_DATA_PART_TYPE) {
      const dataPart = conversationDataPartSchema.safeParse(part);
      if (!dataPart.success) {
        malformed.push(part);
        return;
      }
      conversationId = dataPart.data.data.conversation_id;
      return;
    }
    const toolKind = GROWTH_CHAT_TOOL_KINDS.find((kind) => typed.data.type === `tool-${kind}`);
    if (toolKind != null) {
      const card = parseGrowthChatToolPart(toolKind, part);
      if (card == null) {
        malformed.push(part);
        return;
      }
      entries.push({ type: "tool", id: entryId, card });
      return;
    }
    // Unknown part type (reasoning, step markers, future tools/data parts): not renderable here, not an error.
  });
  return { entries, conversationId, malformed };
}

/** Folds a whole stored transcript, reporting unrenderable content once instead of per message. */
export function foldGrowthChatTranscript(messages: unknown[]): { entries: GrowthChatTranscriptEntry[], malformed: unknown[] } {
  const entries: GrowthChatTranscriptEntry[] = [];
  const malformed: unknown[] = [];
  messages.forEach((message, index) => {
    const result = growthChatUiMessageToEntries(message, `loaded:${index}`);
    entries.push(...result.entries);
    malformed.push(...result.malformed);
  });
  return { entries, malformed };
}

// -------------------------------------------------- demo fixtures --------------------------------------------------

export const GROWTH_CHAT_DEMO_CONVERSATION_ID = "growth-chat-demo-conversation";

/**
 * Demo mode's single deterministic fixture conversation. growth-demo-data.ts is frozen and has no
 * chat builder, so (per the 9B scope) this small fixture lives here instead; it reuses the shared
 * demo clock so timestamps line up with the rest of the demo workspace. The composer is disabled in
 * demo mode, so this transcript is read-only by construction.
 */
export function buildGrowthChatDemoConversation(): { summary: GrowthChatConversationSummary, entries: GrowthChatTranscriptEntry[] } {
  const createdAtMillis = GROWTH_DEMO_NOW_MILLIS - 26 * 60 * 60 * 1000;
  return {
    summary: {
      id: GROWTH_CHAT_DEMO_CONVERSATION_ID,
      title: "Why did signups dip last week?",
      createdAtMillis,
      updatedAtMillis: createdAtMillis + 3 * 60 * 1000,
    },
    entries: [
      { type: "text", id: "demo:1", role: "user", text: "Why did signups dip last week?" },
      {
        type: "text",
        id: "demo:2",
        role: "assistant",
        text: "Signups fell about **18%** week-over-week, and nearly all of the drop is on mobile. Two things stand out:\n\n1. The OAuth sign-up completion rate on mobile fell from 74% to 52% on Tuesday — the same day your last deploy went out.\n2. Traffic itself was flat, so this is a conversion problem, not an acquisition problem.\n\nI'd start by checking the mobile OAuth redirect flow from that deploy.",
      },
      { type: "text", id: "demo:3", role: "user", text: "Can you set up something to keep an eye on it?" },
      {
        type: "tool",
        id: "demo:4",
        card: { kind: "create-action-item", label: "Watch mobile OAuth completion rate", errored: false, createdActionItemId: null, hasWorkflow: true },
      },
      {
        type: "text",
        id: "demo:5",
        role: "assistant",
        text: "Done — I proposed an automation that checks the mobile OAuth completion rate every morning and flags it in your daily brief if it stays below 70%. Review and activate it from the action item; once active it shows up on the Automations page.",
      },
    ],
  };
}

// -------------------------------------------------- fetchers --------------------------------------------------

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  created_at_millis: z.number(),
  updated_at_millis: z.number(),
});

const conversationListSchema = z.object({ conversations: z.array(conversationSummarySchema) });

const conversationDetailSchema = conversationSummarySchema.extend({
  // Opaque AI SDK UIMessages — narrowed by growthChatUiMessageToEntries, never validated here (same
  // stance as growth-api's interview `messages`).
  messages: z.array(z.unknown()),
});

function mapConversationSummary(value: z.infer<typeof conversationSummarySchema>): GrowthChatConversationSummary {
  return {
    id: value.id,
    title: value.title,
    createdAtMillis: value.created_at_millis,
    updatedAtMillis: value.updated_at_millis,
  };
}

// Same request/error policy as growth-api's requestJson (that module is frozen, so the two growth
// chat GETs get their own copy): non-OK responses become GrowthApiError with the safe `error`
// message when the body carries one.
async function requestJson(app: object, path: string): Promise<unknown> {
  const response = await sendInternalAdminRequest(app, `/internal/growth${path}`, { headers: { "content-type": "application/json" } });
  const text = await response.text();
  if (!response.ok) {
    let message = `Growth request failed with status ${response.status}`;
    try {
      const body = z.object({ error: z.string().optional() }).passthrough().parse(JSON.parse(text));
      message = body.error ?? message;
    } catch {
      // A non-JSON proxy response has no safe message to expose; keep the status fallback.
    }
    throw new GrowthApiError(response.status, message);
  }
  return text.length === 0 ? {} : JSON.parse(text);
}

export async function listGrowthChatConversations(app: object): Promise<GrowthChatConversationSummary[]> {
  const response = conversationListSchema.parse(await requestJson(app, "/chat/conversations"));
  return response.conversations.map(mapConversationSummary);
}

export async function getGrowthChatConversation(app: object, conversationId: string): Promise<{ summary: GrowthChatConversationSummary, messages: unknown[] }> {
  const response = conversationDetailSchema.parse(await requestJson(app, urlString`/chat/conversations/${conversationId}`));
  return { summary: mapConversationSummary(response), messages: response.messages };
}

// -------------------------------------------------- the hook --------------------------------------------------

export type GrowthChatListState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", conversations: GrowthChatConversationSummary[] };

export type GrowthChatThreadState =
  /** conversationId is null for a fresh, not-yet-persisted chat (entries then hold nothing committed). */
  | { status: "loaded", conversationId: string | null, entries: GrowthChatTranscriptEntry[] }
  | { status: "loading", conversationId: string }
  | { status: "error", conversationId: string, message: string };

export type GrowthChatTurnState =
  | { status: "idle" }
  | { status: "streaming", entries: GrowthChatTranscriptEntry[] }
  /** failedMessage powers retry: nothing was persisted server-side (see the backend's persist-after-proxy contract), so retrying simply re-sends. */
  | { status: "error", message: string, failedMessage: string };

export type UseGrowthChatResult = {
  list: GrowthChatListState,
  thread: GrowthChatThreadState,
  turn: GrowthChatTurnState,
  sendMessage: (text: string) => Promise<void>,
  retryFailedMessage: () => Promise<void>,
  selectConversation: (conversationId: string) => Promise<void>,
  startNewChat: () => void,
  reloadConversations: () => Promise<void>,
  reloadThread: () => Promise<void>,
  demo: boolean,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extractStreamErrorMessage(statusCode: number, bodyText: string): string {
  let message = `Growth request failed with status ${statusCode}`;
  try {
    const body = z.object({ error: z.string().optional() }).passthrough().parse(JSON.parse(bodyText));
    message = body.error ?? message;
  } catch {
    // Same policy as requestJson: a non-JSON proxy response has no safe message.
  }
  return message;
}

/**
 * Loads and drives the growth chat page. `app` must be the project's own admin app (same
 * authorization story as growth-api.ts). In demo mode nothing ever touches the network: the fixture
 * conversation renders read-only and the composer is disabled, so sendMessage is unreachable there.
 */
export function useGrowthChat(options: { app: object, demo: boolean }): UseGrowthChatResult {
  const { app, demo } = options;
  const demoFixture = demo ? buildGrowthChatDemoConversation() : null;
  const [list, setList] = useState<GrowthChatListState>({ status: "loading" });
  const [thread, setThread] = useState<GrowthChatThreadState>(
    demoFixture != null
      ? { status: "loaded", conversationId: demoFixture.summary.id, entries: demoFixture.entries }
      : { status: "loaded", conversationId: null, entries: [] },
  );
  const [turn, setTurn] = useState<GrowthChatTurnState>({ status: "idle" });
  // Refs mirror the latest state for the async machinery; the nonce invalidates in-flight loads and
  // turns whenever the user switches conversations underneath them.
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const loadNonceRef = useRef(0);

  const reloadConversations = useCallback(async () => {
    if (demo) {
      setList({ status: "loaded", conversations: [buildGrowthChatDemoConversation().summary] });
      return;
    }
    setList({ status: "loading" });
    try {
      setList({ status: "loaded", conversations: await listGrowthChatConversations(app) });
    } catch (error) {
      captureError("growth-chat-conversations-load", error);
      setList({ status: "error", message: errorMessage(error) });
    }
  }, [app, demo]);

  useEffect(() => {
    runAsynchronously(reloadConversations());
  }, [reloadConversations]);

  // Reset the thread when demo mode flips (the fixture id would otherwise leak into live mode and
  // vice versa); reloadConversations above already re-runs for the same reason.
  useEffect(() => {
    loadNonceRef.current++;
    setTurn({ status: "idle" });
    const fixture = demo ? buildGrowthChatDemoConversation() : null;
    setThread(fixture != null
      ? { status: "loaded", conversationId: fixture.summary.id, entries: fixture.entries }
      : { status: "loaded", conversationId: null, entries: [] });
  }, [demo]);

  const loadConversation = useCallback(async (conversationId: string) => {
    loadNonceRef.current++;
    const nonce = loadNonceRef.current;
    setTurn({ status: "idle" });
    if (demo) {
      const fixture = buildGrowthChatDemoConversation();
      setThread({ status: "loaded", conversationId: fixture.summary.id, entries: fixture.entries });
      return;
    }
    setThread({ status: "loading", conversationId });
    try {
      const detail = await getGrowthChatConversation(app, conversationId);
      if (loadNonceRef.current !== nonce) return;
      const { entries, malformed } = foldGrowthChatTranscript(detail.messages);
      if (malformed.length > 0) {
        captureError("growth-chat-transcript-parse", { message: "Stored growth chat transcript contained unrenderable parts", malformed });
      }
      setThread({ status: "loaded", conversationId, entries });
    } catch (error) {
      if (loadNonceRef.current !== nonce) return;
      captureError("growth-chat-conversation-load", error);
      setThread({ status: "error", conversationId, message: errorMessage(error) });
    }
  }, [app, demo]);

  const startNewChat = useCallback(() => {
    if (demo) return;
    loadNonceRef.current++;
    setTurn({ status: "idle" });
    setThread({ status: "loaded", conversationId: null, entries: [] });
  }, [demo]);

  const sendMessage = useCallback(async (text: string) => {
    if (demo) {
      // The composer is disabled (not hidden) in demo mode, so reaching this is a page bug.
      throw new Error("Growth chat messages cannot be sent in demo mode — the composer should be disabled.");
    }
    const currentThread = threadRef.current;
    if (currentThread.status !== "loaded") {
      throw new Error("A growth chat message was sent before the conversation loaded — the composer is only rendered in the loaded state.");
    }
    if (turnRef.current.status === "streaming") return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const nonce = loadNonceRef.current;
    const userEntry: GrowthChatTranscriptEntry = { type: "text", id: `local-user:${Date.now()}`, role: "user", text: trimmed };
    setTurn({ status: "streaming", entries: [userEntry] });
    try {
      const response = await sendInternalAdminRequest(app, "/internal/growth/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          ...currentThread.conversationId == null ? {} : { conversation_id: currentThread.conversationId },
          message: trimmed,
        }),
      });
      if (!response.ok) {
        throw new GrowthApiError(response.status, extractStreamErrorMessage(response.status, await response.text()));
      }
      if (response.body == null) {
        throw new Error("The growth chat stream response carried no body.");
      }
      // Same parse pipeline as the interview stream: SSE of JSON events, validated by the AI SDK's
      // own chunk schema, with malformed chunks reported and skipped rather than aborting the turn.
      const chunkStream = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema }).pipeThrough(
        new TransformStream<
          { success: true, value: UIMessageChunk, rawValue: unknown } | { success: false, error: unknown, rawValue: unknown },
          UIMessageChunk
        >({
          transform(parseResult, controller) {
            if (parseResult.success) {
              controller.enqueue(parseResult.value);
            } else {
              captureError("growth-chat-stream-parse", { error: parseResult.error, rawValue: parseResult.rawValue });
            }
          },
        }),
      );
      let assistantEntries: GrowthChatTranscriptEntry[] = [];
      let malformed: unknown[] = [];
      let streamedConversationId: string | null = null;
      for await (const uiMessage of readUIMessageStream({ stream: chunkStream })) {
        if (loadNonceRef.current !== nonce) return;
        const result = growthChatUiMessageToEntries(uiMessage, `turn:${nonce}`);
        assistantEntries = result.entries;
        malformed = result.malformed;
        if (result.conversationId != null) streamedConversationId = result.conversationId;
        setTurn({ status: "streaming", entries: [userEntry, ...assistantEntries] });
      }
      if (malformed.length > 0) {
        captureError("growth-chat-turn-parse", { message: "Streamed growth chat turn contained unrenderable parts", malformed });
      }
      if (loadNonceRef.current !== nonce) return;
      // The data part is the authoritative id channel; a stream without one is a broken backend.
      // Note the turn DID persist at this point, so this error (unlike a proxy failure) should not
      // be retried blindly — but it can only happen if the backend contract is violated, so failing
      // loudly is the right call.
      const conversationId = currentThread.conversationId
        ?? streamedConversationId
        ?? throwErr("The growth chat stream did not carry a data-growth-conversation part for a new conversation.");
      setThread({ status: "loaded", conversationId, entries: [...currentThread.entries, userEntry, ...assistantEntries] });
      setTurn({ status: "idle" });
      // Refresh the sidebar so the (possibly new) conversation surfaces at the top with its derived
      // title. A refresh failure must not disturb the successfully-sent chat, hence fire-and-forget:
      // reloadConversations reports its own errors into the list state.
      runAsynchronously(reloadConversations());
    } catch (error) {
      if (loadNonceRef.current !== nonce) return;
      captureError("growth-chat-turn", error);
      setTurn({ status: "error", message: errorMessage(error), failedMessage: trimmed });
    }
  }, [app, demo, reloadConversations]);

  const retryFailedMessage = useCallback(async () => {
    const currentTurn = turnRef.current;
    if (currentTurn.status !== "error") {
      throw new Error("There is no failed growth chat message to retry — the retry affordance is only rendered in the turn error state.");
    }
    setTurn({ status: "idle" });
    await sendMessage(currentTurn.failedMessage);
  }, [sendMessage]);

  const reloadThread = useCallback(async () => {
    const current = threadRef.current;
    if (current.status === "loaded" && current.conversationId == null) return;
    await loadConversation(current.conversationId ?? throwErr("unreachable: only the fresh-chat thread has a null conversation id, and it returned above"));
  }, [loadConversation]);

  return {
    list,
    thread,
    turn,
    sendMessage,
    retryFailedMessage,
    selectConversation: loadConversation,
    startNewChat,
    reloadConversations,
    reloadThread,
    demo,
  };
}
