import { getPublicEnvVar } from "@/lib/env";
import {
  BUNDLED_DASHBOARD_UI_TYPES,
  loadSelectedTypeDefinitions,
  selectRelevantFiles,
} from "@/lib/ai-dashboard/shared-prompt";
import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Sanitizes AI-generated JSX/TSX code before it is applied to renderers.
 *
 * Handles four common model output issues:
 * 1. Markdown code fences (```tsx ... ```) wrapping the output despite instructions
 * 2. HTML-encoded angle brackets (&lt;Component&gt; instead of <Component>)
 * 3. Bare & in JSX text content (invalid JSX; must be &amp; or {"&"})
 * 4. Semicolons used as property separators in JS object literals instead of commas
 *    (the AI confuses TypeScript interface syntax with JS object syntax).
 *    TypeScript also accepts commas in interfaces/types, so replacing ; → , is always safe.
 */
function sanitizeGeneratedCode(code: string): string {
  let result = code.trim();

  if (result.startsWith("```")) {
    const lines = result.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    result = lines.join("\n").trim();
  }

  result = result
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  result = result.replace(/;(\s*\n\s*[A-Za-z_$][\w$]*\s*:)/g, ",$1");

  return result;
}

const DASHBOARD_SYSTEM_PROMPTS = new Set(["create-dashboard"]);

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
    quality = "smartest",
    speed = "fast",
  } = payload;

  const user = await stackServerApp.getUser({ or: "redirect" });
  const accessToken = await user.getAccessToken();

  const projects = await user.listOwnedProjects();
  const hasProjectAccess = projects.some((p) => p.id === projectId);

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

  const authHeaders = {
    "x-stack-access-type": "admin",
    "x-stack-project-id": projectId,
    "x-stack-admin-access-token": accessToken,
  };

  let finalMessages = messages;

  if (DASHBOARD_SYSTEM_PROMPTS.has(systemPrompt)) {
    const aiConfig = { backendBaseUrl, headers: authHeaders };

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

    finalMessages = [...contextMessages, ...messages];
  }

  const makeRequest = (withAuth: boolean) =>
    fetch(
      `${backendBaseUrl}/api/latest/ai/query/generate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(withAuth ? authHeaders : {}),
        },
        body: JSON.stringify({ quality, speed, systemPrompt, tools, messages: finalMessages }),
      }
    );

  let backendResponse = await makeRequest(true);

  if (!backendResponse.ok) {
    backendResponse = await makeRequest(false);
  }

  if (!backendResponse.ok) {
    const error = await backendResponse.json().catch(() => ({ error: "Unknown error" }));
    return new Response(JSON.stringify(error), {
      status: backendResponse.status,
      headers: { "content-type": "application/json" },
    });
  }

  const result = await backendResponse.json();
  const contentArr: Array<{ type: string, args?: { content?: string, [key: string]: unknown }, [key: string]: unknown }> =
    Array.isArray(result?.content) ? result.content : [];
  const sanitized = {
    content: contentArr.map((item) => {
      if (item.type === "tool-call" && typeof item.args?.content === "string") {
        return { ...item, args: { ...item.args, content: sanitizeGeneratedCode(item.args.content) } };
      }
      return item;
    }),
  };

  return new Response(JSON.stringify(sanitized), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
