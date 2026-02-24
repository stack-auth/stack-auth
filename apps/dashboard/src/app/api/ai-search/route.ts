import { getPublicEnvVar } from "@/lib/env";
import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { convertToModelMessages, UIMessage } from "ai";

export async function POST(req: Request) {
  const payload = (await req.json()) as { messages?: UIMessage[], projectId?: string | null };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const projectId = payload.projectId ?? null;

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await stackServerApp.getUser({ or: "redirect" });
  const accessToken = await user.getAccessToken();

  let hasProjectAccess = false;
  if (projectId) {
    const projects = await user.listOwnedProjects();
    hasProjectAccess = projects.some((p) => p.id === projectId);
  }

  // sql-query is only available when the user has admin access to the project,
  // so the backend can scope Clickhouse queries to the right project via auth context
  const tools = hasProjectAccess ? ["docs", "sql-query"] : ["docs"];

  const modelMessages = await convertToModelMessages(messages);

  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("Backend API URL is not configured (NEXT_PUBLIC_STACK_API_URL)");

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
  };


  if (projectId && hasProjectAccess && accessToken) {
    requestHeaders["x-stack-access-type"] = "admin";
    requestHeaders["x-stack-project-id"] = projectId;
    requestHeaders["x-stack-admin-access-token"] = accessToken;
  }

  const backendResponse = await fetch(
    `${backendBaseUrl}/api/latest/ai/query/stream`,
    {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        quality: "smart",
        speed: "fast",
        tools,
        systemPrompt: "command-center-ask-ai",
        messages: modelMessages,
      }),
    }
  );

  if (!backendResponse.ok) {
    const error = await backendResponse.json().catch(() => ({ error: "Unknown error" }));
    return new Response(JSON.stringify(error), {
      status: backendResponse.status,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "content-type":
        backendResponse.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}
