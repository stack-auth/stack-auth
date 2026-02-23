import {
  BUNDLED_DASHBOARD_UI_TYPES,
  DASHBOARD_SHARED_RULES,
  anthropic,
  loadSelectedTypeDefinitions,
  selectRelevantFiles,
} from "@/lib/ai-dashboard/shared-prompt";
import { stackServerApp } from "@/stack";
import { generateText, hasToolCall, tool } from "ai";
import { z } from "zod";

const DASHBOARD_EDIT_SYSTEM_PROMPT = `
[IDENTITY]
You are an expert analytics dashboard editor for Stack Auth.
You help users modify their existing dashboard by updating its React/JSX source code.
When the user asks for changes, you MUST call the updateDashboard tool with the COMPLETE updated source code.
Do not return partial code or diffs — always return the full updated source.
${DASHBOARD_SHARED_RULES}
────────────────────────────────────────
EDITING BEHAVIOR
────────────────────────────────────────
- When the user asks for a change, understand what they want and modify the existing code accordingly.
- Always preserve parts of the dashboard the user didn't ask to change.
- If the user asks to add something, add it without removing existing content.
- If the user asks to change styling, colors, or layout, make those changes while preserving functionality.
- If the user asks to create a dashboard from scratch (no existing code), generate a complete dashboard.
- Always call the updateDashboard tool with the full updated source code.
`;

const AI_REQUEST_TIMEOUT_MS = 120_000;

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "tool"]),
    content: z.unknown(),
  })).min(1),
  currentSource: z.string(),
});

export async function POST(req: Request) {
  const user = await stackServerApp.getUser({ or: "redirect" });
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = requestSchema.parse(await req.json());

  const lastUserMessage = [...body.messages].reverse().find(m => m.role === "user");
  const promptForFileSelection = typeof lastUserMessage?.content === "string"
    ? lastUserMessage.content
    : Array.isArray(lastUserMessage?.content)
      ? (lastUserMessage.content as Array<{ type: string, text?: string }>).find(c => c.type === "text")?.text ?? "dashboard"
      : "dashboard";

  const selectedFiles = await selectRelevantFiles(promptForFileSelection);
  const typeDefinitions = loadSelectedTypeDefinitions(selectedFiles);

  const currentSourceContext = body.currentSource.length > 0
    ? `\n\nCURRENT DASHBOARD SOURCE CODE:\n\`\`\`tsx\n${body.currentSource}\n\`\`\``
    : "\n\nThere is no existing dashboard code yet. Generate a complete dashboard from scratch.";

  const systemPrompt = DASHBOARD_EDIT_SYSTEM_PROMPT + currentSourceContext +
    `\n\nTYPE DEFINITIONS:\n${typeDefinitions}\n\nDASHBOARD UI TYPE DEFINITIONS:\n${BUNDLED_DASHBOARD_UI_TYPES}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5"),
      system: systemPrompt,
      messages: body.messages as any, // Cast needed: content is a mixed type from zod schema that doesn't map to AI SDK's strict typing
      tools: {
        updateDashboard: tool({
          description: "Update the dashboard with new source code. The source code must define a React functional component named 'Dashboard' (no props). It runs inside a sandboxed iframe with React, Recharts, DashboardUI, and stackServerApp available as globals. No imports, exports, or require statements.",
          inputSchema: z.object({
            content: z.string().describe("The complete updated JSX source code for the Dashboard component"),
          }),
        }),
      },
      stopWhen: hasToolCall("updateDashboard"),
      abortSignal: controller.signal,
    });

    const contentBlocks: Array<{ type: string, [key: string]: unknown }> = [];
    for (const step of result.steps) {
      if (step.text) {
        contentBlocks.push({ type: "text", text: step.text });
      }
      for (const toolCall of step.toolCalls) {
        contentBlocks.push({
          type: "tool-call",
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          args: toolCall.input,
          argsText: JSON.stringify(toolCall.input),
          result: "success",
        });
      }
    }

    return Response.json({ content: contentBlocks });
  } catch (err: any) {
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
