import { buildDashboardMessages } from "@/lib/ai-dashboard/shared-prompt";
import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";
import type { AppId } from "@/lib/apps-frontend";
import {
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ExportedMessageRepository,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { StackAdminApp } from "@stackframe/stack";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import type { EditableMetadata } from "@stackframe/stack-shared/dist/utils/jsx-editable-transpiler";

export type ToolCallContent = Extract<ChatContent[number], { type: "tool-call" }>;

const isToolCall = (content: { type: string }): content is ToolCallContent => {
  return content.type === "tool-call";
};

/**
 * Sanitizes AI-generated JSX/TSX code before it is applied to the renderer.
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

function stripCodeFences(code: string): string {
  if (!code.startsWith("```")) return code;
  const lines = code.split("\n");
  lines.shift();
  if (lines[lines.length - 1]?.trim() === "```") lines.pop();
  return lines.join("\n");
}

/**
 * Sends a request to the AI query endpoint and returns the parsed content.
 */
async function sendAiRequest(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  body: {
    quality: string,
    speed: string,
    systemPrompt: string,
    tools: string[],
    messages: Array<{ role: string, content: unknown }>,
  },
  abortSignal?: AbortSignal,
): Promise<ChatContent> {
  const authHeaders = await buildStackAuthHeaders(currentUser);

  const response = await fetch(`${backendBaseUrl}/api/latest/ai/query/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    ...(abortSignal ? { signal: abortSignal } : {}),
    body: JSON.stringify(body),
  });

  const json = await response.json() as { content?: ChatContent };
  return Array.isArray(json.content) ? json.content : [];
}

/**
 * Sanitizes tool call content in AI response and returns the sanitized content.
 */
function sanitizeAiContent(content: ChatContent): ChatContent {
  return content.map((item) => {
    if (item.type === "tool-call" && typeof item.args?.content === "string") {
      return { ...item, args: { ...item.args, content: sanitizeGeneratedCode(item.args.content) } };
    }
    return item;
  });
}

/**
 * One-shot dashboard generation: builds context, calls AI, returns the tool call content.
 * Used by both the cmd+K preview and the dashboard chat adapter.
 */
export async function generateDashboardCode(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  messages: Array<{ role: string, content: unknown }>,
  options?: {
    currentTsxSource?: string,
    abortSignal?: AbortSignal,
    enabledAppIds?: AppId[],
  },
): Promise<{ content: ChatContent, toolCall: ToolCallContent | undefined }> {
  const contextMessages = await buildDashboardMessages(
    backendBaseUrl,
    currentUser,
    messages,
    options?.currentTsxSource,
    options?.enabledAppIds,
  );
  const rawContent = await sendAiRequest(
    backendBaseUrl,
    currentUser,
    {
      quality: "smart",
      speed: "slow",
      systemPrompt: "create-dashboard",
      tools: ["update-dashboard"],
      messages: [...contextMessages, ...messages],
    },
    options?.abortSignal,
  );

  const toolCall = rawContent.find(isToolCall);

  return { content: rawContent, toolCall };
}

const CONTEXT_MAP = {
  "email-theme": { systemPrompt: "email-assistant-theme", tools: ["create-email-theme"] },
  "email-template": { systemPrompt: "email-assistant-template", tools: ["create-email-template"] },
  "email-draft": { systemPrompt: "email-assistant-draft", tools: ["create-email-draft"] },
} as const;

export function createChatAdapter(
  backendBaseUrl: string,
  contextType: "email-theme" | "email-template" | "email-draft",
  onToolCall: (toolCall: ToolCallContent) => void,
  getCurrentSource?: () => string,
  currentUser?: CurrentUser,
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }: ChatModelRunOptions) {
      try {
        const formattedMessages: Array<{ role: string, content: unknown }> = [];
        for (const msg of messages) {
          const textContent = msg.content.filter(c => !isToolCall(c));
          if (textContent.length > 0) {
            formattedMessages.push({ role: msg.role, content: textContent });
          }
        }

        const { systemPrompt, tools } = CONTEXT_MAP[contextType];

        const contextMessages: Array<{ role: string, content: unknown }> = [];
        if (getCurrentSource) {
          const src = getCurrentSource();
          if (src.length > 0) {
            contextMessages.push({ role: "user", content: `Here is the current source:\n\`\`\`tsx\n${src}\n\`\`\`` });
            contextMessages.push({ role: "assistant", content: "Got it, I have the current source code." });
          }
        }

        const rawContent = await sendAiRequest(
          backendBaseUrl,
          currentUser,
          {
            quality: "smartest",
            speed: "fast",
            systemPrompt,
            tools: [...tools],
            messages: [...contextMessages, ...formattedMessages],
          },
          abortSignal,
        );

        const sanitizedContent = sanitizeAiContent(rawContent);

        const toolCall = sanitizedContent.find(isToolCall);
        if (toolCall) {
          onToolCall(toolCall);
        }

        return { content: sanitizedContent };
      } catch (error) {
        if (abortSignal.aborted) {
          return {};
        }
        throw new Error("Failed to get AI response. Please try again.");
      }
    },
  };
}

export function createDashboardChatAdapter(
  backendBaseUrl: string,
  currentTsxSource: string,
  onToolCall: (toolCall: ToolCallContent) => void,
  currentUser?: CurrentUser,
  enabledAppIds?: AppId[],
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }: ChatModelRunOptions) {
      try {
        const formattedMessages: Array<{ role: string, content: unknown }> = [];
        for (const msg of messages) {
          const textContent = msg.content.filter(c => !isToolCall(c));
          if (textContent.length > 0) {
            formattedMessages.push({ role: msg.role, content: textContent });
          }
        }

        const { content, toolCall } = await generateDashboardCode(
          backendBaseUrl,
          currentUser,
          formattedMessages,
          {
            currentTsxSource,
            abortSignal,
            enabledAppIds,
          },
        );

        if (toolCall) {
          onToolCall(toolCall);
        }

        return { content };
      } catch (error) {
        if (abortSignal.aborted) {
          return {};
        }
        throw new Error("Failed to get AI response. Please try again.");
      }
    },
  };
}

export async function applyWysiwygEdit(
  backendBaseUrl: string,
  options: {
    sourceType: "template" | "theme" | "draft",
    sourceCode: string,
    oldText: string,
    newText: string,
    metadata: EditableMetadata,
    domPath: Array<{ tagName: string, index: number }>,
    htmlContext: string,
    currentUser?: CurrentUser,
  },
): Promise<{ updatedSource: string }> {
  if (options.oldText === options.newText) {
    return { updatedSource: options.sourceCode };
  }

  const { sourceCode, oldText, newText, metadata, domPath, htmlContext } = options;

  const userPrompt = `
## Source Code to Edit
\`\`\`tsx
${sourceCode}
\`\`\`

## Edit Request
- **Old text:** "${oldText}"
- **New text:** "${newText}"

## Location Information
- **Line:** ${metadata.loc.line}
- **Column:** ${metadata.loc.column}
- **JSX Path:** ${metadata.jsxPath.join(" > ")}
- **Parent Element:** <${metadata.parentElement.tagName}>
- **Sibling Index:** ${metadata.siblingIndex}
- **Occurrence:** ${metadata.occurrenceIndex} of ${metadata.occurrenceCount}

## Source Context (lines around the text)
Before:
\`\`\`
${metadata.sourceContext.before}
\`\`\`

After:
\`\`\`
${metadata.sourceContext.after}
\`\`\`

## Runtime DOM Path (for disambiguation)
${domPath.map((p, i) => `${i + 1}. <${p.tagName}> (index: ${p.index})`).join("\n")}

## Rendered HTML Context
\`\`\`html
${htmlContext.slice(0, 500)}
\`\`\`

Please update the source code to change "${oldText}" to "${newText}" at the specified location. Return ONLY the complete updated source code.
`;

  const { currentUser } = options;
  const authHeaders = await buildStackAuthHeaders(currentUser);

  const response = await fetch(`${backendBaseUrl}/api/latest/ai/query/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({
      quality: "smart",
      speed: "fast",
      systemPrompt: "wysiwyg-edit",
      tools: [],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  const json = await response.json() as { content?: Array<{ type: string, text?: string }> };
  const textBlock = Array.isArray(json.content)
    ? json.content.find((b) => b.type === "text" && b.text)
    : undefined;
  const updatedSource = stripCodeFences(textBlock?.text?.trim() ?? sourceCode);

  return { updatedSource };
}

export function createHistoryAdapter(
  adminApp: StackAdminApp,
  threadId: string,
): ThreadHistoryAdapter {
  return {
    async load() {
      const { messages } = await adminApp.listChatMessages(threadId);
      return { messages } as ExportedMessageRepository;
    },
    async append(message) {
      await adminApp.saveChatMessage(threadId, message);
    },
  };
}
