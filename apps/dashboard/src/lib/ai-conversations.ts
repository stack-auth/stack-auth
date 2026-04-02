import { buildStackAuthHeaders, CurrentUser } from "@/lib/api-headers";
import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

export type ConversationSummary = {
  id: string,
  title: string,
  projectId: string,
  updatedAt: string,
};

export type ConversationDetail = {
  id: string,
  title: string,
  projectId: string,
  messages: Array<{
    id: string,
    role: "user" | "assistant",
    content: unknown,
  }>,
};

function getBaseUrl() {
  return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
}

async function apiFetch(
  currentUser: CurrentUser | null,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers = await buildStackAuthHeaders(currentUser);
  const response = await fetch(`${getBaseUrl()}/api/latest/internal/ai-conversations${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { "content-type": "application/json" } : {}),
      ...headers,
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`AI conversations API error: ${response.status}`);
  }
  return response;
}

export async function listConversations(
  currentUser: CurrentUser | null,
  projectId: string,
): Promise<ConversationSummary[]> {
  const response = await apiFetch(currentUser, `?projectId=${encodeURIComponent(projectId)}`);
  const data = await response.json();
  return data.conversations;
}

export async function createConversation(
  currentUser: CurrentUser | null,
  data: { title: string, projectId: string, messages: Array<{ role: string, content: unknown }> },
): Promise<{ id: string, title: string }> {
  const response = await apiFetch(currentUser, "", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return await response.json();
}

export async function getConversation(
  currentUser: CurrentUser | null,
  conversationId: string,
): Promise<ConversationDetail> {
  const response = await apiFetch(currentUser, `/${encodeURIComponent(conversationId)}`);
  return await response.json();
}

export async function updateConversationTitle(
  currentUser: CurrentUser | null,
  conversationId: string,
  title: string,
): Promise<void> {
  await apiFetch(currentUser, `/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function replaceConversationMessages(
  currentUser: CurrentUser | null,
  conversationId: string,
  messages: Array<{ role: string, content: unknown }>,
): Promise<void> {
  await apiFetch(currentUser, `/${conversationId}/messages`, {
    method: "PUT",
    body: JSON.stringify({ messages }),
  });
}

export async function deleteConversation(
  currentUser: CurrentUser | null,
  conversationId: string,
): Promise<void> {
  await apiFetch(currentUser, `/${conversationId}`, {
    method: "DELETE",
  });
}
