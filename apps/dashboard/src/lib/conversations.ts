import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";
import { getPublicEnvVar } from "@/lib/env";
import type {
  ConversationDetailResponse,
  ConversationSummary,
  ConversationPriority,
  ConversationStatus,
} from "@/lib/conversation-types";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

type ListConversationsOptions = {
  projectId: string,
  query?: string,
  status?: ConversationStatus,
  userId?: string,
};

function getBaseUrl() {
  return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
}

async function apiFetch(
  currentUser: CurrentUser | null,
  path: string,
  options: RequestInit = {},
) {
  const headers = await buildStackAuthHeaders(currentUser);
  const response = await fetch(`${getBaseUrl()}/api/latest/internal/conversations${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { "content-type": "application/json" } : {}),
      ...headers,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Conversations API error: ${response.status}`);
  }
  return response;
}

export async function listConversations(currentUser: CurrentUser | null, options: ListConversationsOptions) {
  const params = new URLSearchParams();
  params.set("projectId", options.projectId);
  if (options.query) params.set("query", options.query);
  if (options.status) params.set("status", options.status);
  if (options.userId) params.set("userId", options.userId);

  const response = await apiFetch(currentUser, `?${params.toString()}`);
  return await response.json() as { conversations: ConversationSummary[] };
}

export async function getConversation(currentUser: CurrentUser | null, options: {
  projectId: string,
  conversationId: string,
}) {
  const params = new URLSearchParams();
  params.set("projectId", options.projectId);
  const response = await apiFetch(currentUser, `/${encodeURIComponent(options.conversationId)}?${params.toString()}`);
  return await response.json() as ConversationDetailResponse;
}

export async function createConversation(currentUser: CurrentUser | null, options: {
  projectId: string,
  userId: string,
  subject: string,
  initialMessage: string,
  priority: ConversationPriority,
}) {
  const response = await apiFetch(currentUser, "", {
    method: "POST",
    body: JSON.stringify(options),
  });
  return await response.json() as { conversationId: string };
}

export async function appendConversationUpdate(currentUser: CurrentUser | null, options:
  | { projectId: string, conversationId: string, type: "internal-note", body: string }
  | { projectId: string, conversationId: string, type: "reply", body: string }
  | { projectId: string, conversationId: string, type: "status", status: ConversationStatus }
  | {
    projectId: string,
    conversationId: string,
    type: "metadata",
    assignedToUserId?: string | null,
    assignedToDisplayName?: string | null,
    priority?: ConversationPriority,
    tags?: string[],
  }
) {
  const payload = (() => {
    if ("body" in options) {
      return { body: options.body };
    }
    if ("status" in options) {
      return { status: options.status };
    }
    return {
      assignedToUserId: options.assignedToUserId,
      assignedToDisplayName: options.assignedToDisplayName,
      priority: options.priority,
      tags: options.tags,
    };
  })();

  const response = await apiFetch(currentUser, `/${encodeURIComponent(options.conversationId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      projectId: options.projectId,
      type: options.type,
      ...payload,
    }),
  });
  return await response.json() as ConversationDetailResponse;
}
