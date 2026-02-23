import { getPublicEnvVar } from "@/lib/env";
import {
  BUNDLED_DASHBOARD_UI_TYPES,
  loadSelectedTypeDefinitions,
  selectRelevantFiles,
} from "@/lib/ai-dashboard/shared-prompt";
import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

export async function POST(req: Request) {
  const payload = await req.json() as {
    projectId: string,
    systemPrompt: string,
    tools: string[],
    messages: Array<{ role: string, content: unknown }>,
    currentSource?: string,
    quality?: string,
    speed?: string,
  };

  const {
    projectId,
    systemPrompt,
    tools,
    messages,
    currentSource,
    quality = "smart",
    speed = "fast",
  } = payload;

  const user = await stackServerApp.getUser({ or: "redirect" });
  const accessToken = await user.getAccessToken();

  const projects = await user.listOwnedProjects();
  const hasProjectAccess = projects.some((p: { id: string }) => p.id === projectId);

  if (!hasProjectAccess || !accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("Backend API URL is not configured (NEXT_PUBLIC_STACK_API_URL)");

  const aiConfig = {
    backendBaseUrl,
    headers: {
      "x-stack-access-type": "admin",
      "x-stack-project-id": projectId,
      "x-stack-admin-access-token": accessToken,
    },
  };

  const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
  const promptForFileSelection = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : Array.isArray(lastUserMessage?.content)
      ? (lastUserMessage.content as Array<{ type: string, text?: string }>).find(c => c.type === "text")?.text ?? "dashboard"
      : "dashboard";

  const selectedFiles = await selectRelevantFiles(promptForFileSelection, aiConfig);
  const typeDefinitions = loadSelectedTypeDefinitions(selectedFiles);

  const contextMessages: Array<{ role: string, content: string }> = [];

  if (currentSource != null && currentSource.length > 0) {
    contextMessages.push({
      role: "user",
      content: `Here is the current dashboard source code:\n\`\`\`tsx\n${currentSource}\n\`\`\`\n\nHere are the type definitions:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}`,
    });
    contextMessages.push({
      role: "assistant",
      content: "I understand the current dashboard code, type definitions, and available UI components. What changes would you like to make?",
    });
  } else {
    contextMessages.push({
      role: "user",
      content: `Here are the type definitions for the Stack SDK:\n${typeDefinitions}\n\nHere are the dashboard UI component types:\n${BUNDLED_DASHBOARD_UI_TYPES}`,
    });
    contextMessages.push({
      role: "assistant",
      content: "I have the type definitions and available UI components. What dashboard would you like me to create?",
    });
  }

  const augmentedMessages = [...contextMessages, ...messages];

  const backendResponse = await fetch(
    `${backendBaseUrl}/api/latest/ai/query/generate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...aiConfig.headers,
      },
      body: JSON.stringify({
        quality,
        speed,
        systemPrompt,
        tools,
        messages: augmentedMessages,
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

  const result = await backendResponse.json() as { content: Array<{ type: string, [key: string]: unknown }> };

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
