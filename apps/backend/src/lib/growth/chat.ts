import type { GrowthChatConversation } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError, HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { randomUUID } from "node:crypto";
import { createGrowthRunToken } from "./run-token";

/**
 * Read/write logic behind the internal/growth/chat* admin routes, kept out of the route files the
 * same way lib/growth/dashboard.ts backs the other internal/growth/* routes.
 *
 * STORAGE DECISION (load-bearing): growth chat has its own GrowthChatConversation /
 * GrowthChatMessage tables. An earlier draft instead reused the dashboard companion widget's
 * AiConversation / AiMessage tables behind a `kind` discriminator, which required relaxing
 * AiConversation.projectUserId to nullable and left the two populations separated only by every
 * present and future query remembering to filter on the right column. Owning the tables makes that
 * isolation structural rather than conventional — a query here cannot reach a companion row.
 *
 * Growth conversations are PROJECT-scoped (all of the project's admins share them), not user-scoped
 * like the companion, because (a) every other growth resource (briefs, milestones, action items) is
 * (projectId, branchId)-scoped and the chat is a view over that shared state, and (b) the dashboard
 * reaches the growth routes through the owned-project admin app, which usually authenticates with
 * the admin key alone and carries NO acting user — a per-user owner would be unfulfillable on the
 * normal path.
 */

// How long one Eve chat turn may take end-to-end. Mirrors EVE_INTERVIEW_TURN_TIMEOUT_MS in
// interview.ts: a turn is one LLM exchange, but it runs a full task-mode agent session (possibly
// with several data-tool calls) on the Eve side, so this is generous rather than snappy.
const EVE_CHAT_TURN_TIMEOUT_MS = 120_000;

// User-visible copy for the proxy-fail path. Unlike the interview (answer-first persistence),
// NOTHING has been persisted when this fires — see streamGrowthChatTurn — so the copy tells the
// user to resend rather than "your answer was saved".
const EVE_UNAVAILABLE_MESSAGE = "The growth assistant could not be reached. Nothing was saved — please send your message again in a moment.";

const MAX_LISTED_CONVERSATIONS = 50;

// Same visual budget as the companion's sidebar titles; anything longer is elided.
const MAX_DERIVED_TITLE_LENGTH = 80;

/**
 * Derives a conversation title from the first user message: whitespace-collapsed and elided to a
 * sidebar-friendly length. Exported for unit tests.
 */
export function deriveGrowthChatTitle(firstMessage: string): string {
  const collapsed = firstMessage.replaceAll(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    // The route schema requires a non-empty message, but "non-empty" does not exclude all-whitespace.
    return "Growth chat";
  }
  return collapsed.length <= MAX_DERIVED_TITLE_LENGTH ? collapsed : `${collapsed.slice(0, MAX_DERIVED_TITLE_LENGTH - 1)}…`;
}

// Prisma throws (rather than returning null) when a findUnique filter value cannot be cast to the
// column type, so a malformed id must be rejected before it reaches the uuid-typed id column.
// Malformed ids are treated exactly like unknown ids (404), never like server errors.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function findOwnedGrowthConversation(tenancy: Tenancy, conversationId: string): Promise<GrowthChatConversation> {
  const conversation = UUID_REGEX.test(conversationId)
    ? await globalPrismaClient.growthChatConversation.findUnique({ where: { id: conversationId } })
    : null;
  // One combined 404 for "does not exist" and "belongs to another project/branch" — distinguishing
  // them would let admins probe other tenants' conversation ids.
  if (conversation == null || conversation.projectId !== tenancy.project.id || conversation.branchId !== tenancy.branchId) {
    throw new StatusError(404, "Conversation not found.");
  }
  return conversation;
}

/** GET /internal/growth/chat/conversations — newest-first summaries for the chat page's sidebar. */
export async function listGrowthChatConversationsBody(tenancy: Tenancy) {
  const conversations = await globalPrismaClient.growthChatConversation.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: MAX_LISTED_CONVERSATIONS,
  });
  return {
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      created_at_millis: conversation.createdAt.getTime(),
      updated_at_millis: conversation.updatedAt.getTime(),
    })),
  };
}

/** GET /internal/growth/chat/conversations/[conversationId] — full transcript for resuming a chat. */
export async function getGrowthChatConversationBody(tenancy: Tenancy, conversationId: string) {
  const conversation = await findOwnedGrowthConversation(tenancy, conversationId);
  const messages = await globalPrismaClient.growthChatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { position: "asc" },
  });
  return {
    id: conversation.id,
    title: conversation.title,
    created_at_millis: conversation.createdAt.getTime(),
    updated_at_millis: conversation.updatedAt.getTime(),
    // Opaque AI SDK UIMessages, whole-object round-trip only (same stance as GrowthInterview
    // .messages): the dashboard hands them to useChat verbatim.
    messages: messages.map((message) => message.content),
  };
}

// Read per call, never at module scope: the e2e suite points this at a mock server whose port is
// only known after the backend module graph has already been loaded (same note as engine.ts).
function getGrowthEveBaseUrl(): string {
  return getEnvVariable("HEXCLAVE_GROWTH_EVE_URL");
}

export type EveAssistantMessage = { id: string, role: "assistant", parts: Record<string, unknown>[] };

/**
 * Narrows the Eve /chat response body. Anything malformed is treated exactly like an unreachable
 * Eve (502 + captureError), never surfaced to the user: from the customer's point of view a garbled
 * agent IS an unavailable agent. Duplicated from interview.ts's parseEveInterviewResponse on
 * purpose (the shared context's "copy the synthesis" directive): the two are separate wire
 * contracts that happen to coincide today, and coupling them would make it impossible to evolve
 * one without re-verifying the other. Exported for unit tests.
 */
export function parseEveChatResponse(json: unknown): EveAssistantMessage | null {
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
 * expects for a single-shot message ("start" -> per-part chunks -> "finish"), prefixed with a
 * `data-growth-conversation` part carrying the conversation id (see streamGrowthChatTurn for why).
 * Only text and tool parts are re-emitted; anything else (reasoning, files, ...) is dropped from
 * the stream but kept in the persisted transcript. Copied from interview.ts's
 * chunksFromAssistantMessage (same duplication rationale as parseEveChatResponse). Exported for
 * unit tests.
 */
export function chunksFromGrowthAssistantMessage(message: EveAssistantMessage, conversationId: string): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    { type: "start", messageId: message.id },
    // First chunk after "start" so the client learns the conversation id even if it stops reading
    // early. Non-transient: it lands in the message's parts, letting the chat page recover the id
    // from a reloaded transcript too.
    { type: "data-growth-conversation", id: randomUUID(), data: { conversation_id: conversationId } },
    { type: "start-step" },
  ];
  for (const part of message.parts) {
    const partType = typeof part.type === "string" ? part.type : throwErr("unreachable: parseEveChatResponse validated part.type");
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
    }
  }
  chunks.push({ type: "finish-step" });
  chunks.push({ type: "finish" });
  return chunks;
}

/** Builds the user-side UIMessage; the backend (not the client, not Eve) authors it so the persisted transcript cannot be spoofed. */
function buildUserMessage(text: string): { id: string, role: "user", parts: { type: "text", text: string }[] } {
  return { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

/**
 * POST /internal/growth/chat — one freeform growth chat turn.
 *
 * 1. Resolves the conversation (if any) and reconstructs the stored transcript.
 * 2. Proxies the turn to Eve's /chat channel route (synchronous, mirrors /interview).
 * 3. Persists BOTH the user and assistant messages — and, for a new chat, the conversation row —
 *    in one transaction, only AFTER Eve succeeded.
 * 4. Responds with a synthesized single-shot AI SDK UI message chunk stream. The conversation id
 *    travels back on BOTH a `x-growth-conversation-id` response header AND a
 *    `data-growth-conversation` data part in the stream. The data part is the AUTHORITATIVE
 *    channel for the dashboard: the backend's CORS config (proxy.tsx corsAllowedResponseHeaders)
 *    does not expose custom headers to cross-origin browser clients, so the header only serves
 *    same-origin/server callers and debugging. 9B's assistant-ui adapter must read the data part.
 *
 * PERSISTENCE ORDER (deliberately the OPPOSITE of the interview's answer-first rule): the
 * interview persists answers before proxying because an answer is irreplaceable structured state.
 * A chat message is not — the client still holds the text and simply resends on failure. Persisting
 * after the proxy means an unreachable Eve can never leave a half-persisted conversation (no empty
 * conversation rows, no user message without a reply), which keeps the conversation list clean and
 * makes retries idempotent from the user's point of view. The e2e suite pins these semantics.
 *
 * STREAMING ADAPTATION (v1, deliberate): same as the interview — Eve waits for the turn and
 * returns the completed assistant UIMessage as JSON, and this function synthesizes the chunk
 * stream. TODO(growth): true incremental streaming by adapting eve events into UI chunks.
 */
export async function streamGrowthChatTurn(tenancy: Tenancy, options: { conversationId: string | undefined, message: string }): Promise<Response> {
  const existingConversation = options.conversationId == null ? null : await findOwnedGrowthConversation(tenancy, options.conversationId);
  const storedMessages = existingConversation == null ? [] : await globalPrismaClient.growthChatMessage.findMany({
    where: { conversationId: existingConversation.id },
    orderBy: { position: "asc" },
  });

  const userMessage = buildUserMessage(options.message);
  const sentTranscript = [...storedMessages.map((message) => message.content), userMessage];

  // Fresh per request (NOT derived from conversation id + turn count): Eve uses it as the session
  // continuation token, and new conversations have no id yet — a deterministic token would collide
  // across two different new chats on the same project. It is also the run token's `sub`, so it is
  // bound here rather than inlined into the body below: the two must be the same value.
  const turnId = randomUUID();

  let assistantMessage: EveAssistantMessage;
  try {
    // Channel routes live at the server root of the Eve app; the path is a code constant.
    const url = getGrowthEveBaseUrl().replace(/\/+$/, "") + "/chat";
    // A chat turn has no durable anchor row, so the run token's short TTL is its whole live-state
    // check (see run-token.ts). It rides in the BODY, never the Authorization header — that header
    // authenticates the hop with the shared machine secret, and the run token scopes the session.
    const agentToken = await createGrowthRunToken({
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      tenancyId: tenancy.id,
      session: { sessionKind: "chat_turn", turnId },
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
        turn_id: turnId,
        transcript: sentTranscript,
        agent_token: agentToken,
      }),
      signal: AbortSignal.timeout(EVE_CHAT_TURN_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new HexclaveAssertionError(`Growth Eve chat turn failed with status ${response.status}`, { status: response.status, responseText: await response.text() });
    }
    assistantMessage = parseEveChatResponse(await response.json())
      ?? throwErr(new HexclaveAssertionError("Growth Eve chat turn returned a malformed body", { conversationId: options.conversationId ?? null }));
  } catch (error) {
    captureError("growth-chat", new HexclaveAssertionError(`Growth chat turn proxy failed for project ${tenancy.project.id}`, { cause: error, conversationId: options.conversationId ?? null }));
    // 502 with a safe message (not a masked 500): the client needs to know the turn is retryable
    // and nothing was persisted. Deliberate exception to the "StatusError is 4xx" rule, mirroring
    // the interview route.
    throw new StatusError(502, EVE_UNAVAILABLE_MESSAGE);
  }

  const conversationId = await retryTransaction(globalPrismaClient, async (tx) => {
    const conversation = existingConversation == null
      ? await tx.growthChatConversation.create({
        data: {
          projectId: tenancy.project.id,
          branchId: tenancy.branchId,
          title: deriveGrowthChatTitle(options.message),
        },
      })
      : await tx.growthChatConversation.findUnique({ where: { id: existingConversation.id } })
        ?? throwErr(new HexclaveAssertionError("GrowthChatConversation row disappeared between read and append — growth conversations are only deleted via project cascade, and the project of an in-flight admin request cannot be deleted mid-request.", { conversationId: existingConversation.id }));
    // Position base is re-read inside the transaction; the dashboard runs one turn at a time, so a
    // concurrent count bump means a retried/raced request, and appending after it is the sane order.
    // If two turns genuinely race, both derive the same base and the (conversationId, position)
    // unique index rejects the loser rather than letting it scramble the transcript order — nothing
    // has been persisted at that point, so the client can simply resend.
    const position = await tx.growthChatMessage.count({ where: { conversationId: conversation.id } });
    // JSON round-trip guarantees Prisma-safe plain-JSON values (same note as the interview's
    // transcript write).
    await tx.growthChatMessage.createMany({
      data: [
        { conversationId: conversation.id, position, role: "user", content: JSON.parse(JSON.stringify(userMessage)) },
        { conversationId: conversation.id, position: position + 1, role: "assistant", content: JSON.parse(JSON.stringify(assistantMessage)) },
      ],
    });
    // Bumps updatedAt so the conversation surfaces at the top of the list.
    await tx.growthChatConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    return conversation.id;
  });

  const chunks = chunksFromGrowthAssistantMessage(assistantMessage, conversationId);
  return createUIMessageStreamResponse({
    headers: { "x-growth-conversation-id": conversationId },
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        for (const chunk of chunks) {
          writer.write(chunk);
        }
      },
    }),
  });
}
