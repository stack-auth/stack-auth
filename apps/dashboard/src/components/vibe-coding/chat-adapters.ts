import { buildDashboardMessages } from "@/lib/ai-dashboard/shared-prompt";
import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";
import type { AppId } from "@/lib/apps-frontend";
import {
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ChatModelRunResult,
  type ExportedMessageRepository,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { StackAdminApp } from "@stackframe/stack";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import type { EditableMetadata } from "@stackframe/stack-shared/dist/utils/jsx-editable-transpiler";
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

export type ToolCallContent = Extract<ChatContent[number], { type: "tool-call" }>;

const isToolCall = (content: { type: string }): content is ToolCallContent => {
  return content.type === "tool-call";
};

export type DashboardWidgetContext = {
  kind: "widget",
  id: string,
  name: string,
  selectorPath: string,
  outerHTMLSnippet: string,
};

export type DashboardActionContext = {
  kind: "action-add-component",
  id: string,
};

export type DashboardErrorContext = {
  kind: "error",
  id: string,
  message: string,
  stack?: string,
  componentStack?: string,
};

export type DashboardChip =
  | DashboardWidgetContext
  | DashboardActionContext
  | DashboardErrorContext;

export type DashboardPatchEdit = {
  oldText: string,
  newText: string,
  occurrenceIndex?: number,
};

export type DashboardPatchFailure = {
  index: number,
  reason: "not-found" | "ambiguous",
  oldTextPreview: string,
};

export type DashboardPatchResult = {
  updatedSource: string,
  applied: number,
  failures: DashboardPatchFailure[],
};

export type DashboardPatchSnapshot = {
  edits: DashboardPatchEdit[],
  resultSource: string,
};

export function applyDashboardPatches(source: string, edits: DashboardPatchEdit[]): DashboardPatchResult {
  let running = source;
  let applied = 0;
  const failures: DashboardPatchFailure[] = [];

  edits.forEach((edit, index) => {
    const preview = edit.oldText.slice(0, 80).replace(/\s+/g, " ");

    const matches: number[] = [];
    let from = 0;
    while (from <= running.length) {
      const at = running.indexOf(edit.oldText, from);
      if (at === -1) break;
      matches.push(at);
      from = at + Math.max(edit.oldText.length, 1);
    }

    if (matches.length === 0) {
      failures.push({ index, reason: "not-found", oldTextPreview: preview });
      return;
    }

    let chosenIndex: number;
    if (edit.occurrenceIndex != null) {
      if (edit.occurrenceIndex < 0 || edit.occurrenceIndex >= matches.length) {
        failures.push({ index, reason: "not-found", oldTextPreview: preview });
        return;
      }
      chosenIndex = matches[edit.occurrenceIndex];
    } else if (matches.length > 1) {
      failures.push({ index, reason: "ambiguous", oldTextPreview: preview });
      return;
    } else {
      chosenIndex = matches[0];
    }

    running = running.slice(0, chosenIndex) + edit.newText + running.slice(chosenIndex + edit.oldText.length);
    applied += 1;
  });

  return { updatedSource: running, applied, failures };
}

function parsePatchEdits(args: unknown): DashboardPatchEdit[] | null {
  if (typeof args !== "object" || args === null) return null;
  const editsRaw = (args as { edits?: unknown }).edits;
  if (!Array.isArray(editsRaw)) return null;
  const edits: DashboardPatchEdit[] = [];
  for (const e of editsRaw) {
    if (typeof e !== "object" || e === null) return null;
    const { oldText, newText, occurrenceIndex } = e as { oldText?: unknown, newText?: unknown, occurrenceIndex?: unknown };
    if (typeof oldText !== "string" || typeof newText !== "string") return null;
    edits.push({
      oldText,
      newText,
      occurrenceIndex: typeof occurrenceIndex === "number" ? occurrenceIndex : undefined,
    });
  }
  return edits;
}

/** Maps thread messages to the backend wire format; merges `attachments` into `content`. */
function formatThreadMessagesForBackend(
  messages: readonly { role: string, content: readonly { type: string }[], attachments?: readonly { content?: readonly unknown[] }[] }[],
): Array<{ role: string, content: unknown }> {
  const formatted: Array<{ role: string, content: unknown }> = [];
  for (const msg of messages) {
    const textContent = msg.content.filter((c) => !isToolCall(c));
    const attachmentContent: unknown[] = [];
    if (msg.attachments) {
      for (const attachment of msg.attachments) {
        if (Array.isArray(attachment.content)) {
          attachmentContent.push(...attachment.content);
        }
      }
    }
    const combined = [...textContent, ...attachmentContent];
    if (combined.length > 0) {
      formatted.push({ role: msg.role, content: combined });
    }
  }
  return formatted;
}

/** Normalizes model JSX: strip fences, decode basic entities, fix `;` vs `,` between object props. */
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
    projectId?: string,
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

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status} ${response.statusText}`);
  }

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
 * Sends a request to the AI streaming endpoint and returns a stream of UIMessageChunks
 * (as produced by the Vercel AI SDK's `streamText().toUIMessageStreamResponse()`).
 */
async function sendAiStreamRequest(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  body: {
    quality: string,
    speed: string,
    systemPrompt: string,
    tools: string[],
    messages: Array<{ role: string, content: unknown }>,
    projectId?: string,
  },
  abortSignal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  const authHeaders = await buildStackAuthHeaders(currentUser);

  const response = await fetch(`${backendBaseUrl}/api/latest/ai/query/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...authHeaders,
    },
    ...(abortSignal ? { signal: abortSignal } : {}),
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI stream request failed: ${response.status} ${response.statusText}`);
  }

  return parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<
      { success: true, value: UIMessageChunk, rawValue: unknown } | { success: false, error: unknown, rawValue: unknown },
      UIMessageChunk
    >({
      transform(parseResult, controller) {
        if (parseResult.success) {
          controller.enqueue(parseResult.value);
        }
      },
    }),
  );
}

/**
 * Converts a UIMessage's parts (as emitted by `readUIMessageStream`) into our
 * ChatContent shape so the existing tool UI / sanitizer pipeline keeps working.
 */
function uiPartsToChatContent(parts: UIMessage["parts"]): ChatContent {
  const result: ChatContent = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text) {
        result.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (part.type === "dynamic-tool") {
      const toolPart = part as { toolCallId: string, toolName: string, input?: unknown, output?: unknown };
      const input = toolPart.input ?? {};
      result.push({
        type: "tool-call",
        toolCallId: toolPart.toolCallId,
        toolName: toolPart.toolName,
        args: input,
        argsText: typeof input === "string" ? input : JSON.stringify(input),
        result: toolPart.output ?? null,
      });
      continue;
    }

    if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      const toolName = part.type.slice("tool-".length);
      const toolPart = part as { toolCallId: string, input?: unknown, output?: unknown };
      const input = toolPart.input ?? {};
      result.push({
        type: "tool-call",
        toolCallId: toolPart.toolCallId,
        toolName,
        args: input,
        argsText: typeof input === "string" ? input : JSON.stringify(input),
        result: toolPart.output ?? null,
      });
      continue;
    }
  }
  return result;
}

/**
 * Streaming dashboard generation: yields progressively updated ChatContent as the AI
 * streams text and tool-call input. Each yield represents the full current state of
 * the assistant message (not an incremental delta).
 */
export async function* streamDashboardCode(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  messages: Array<{ role: string, content: unknown }>,
  options?: {
    currentTsxSource?: string,
    abortSignal?: AbortSignal,
    enabledAppIds?: AppId[],
    projectId?: string,
  },
): AsyncGenerator<ChatContent, void, undefined> {
  const contextMessages = await buildDashboardMessages(
    backendBaseUrl,
    currentUser,
    messages,
    options?.currentTsxSource,
    options?.enabledAppIds,
  );

  // Only give the agent the sql-query tool when we know which project to scope it to.
  // Without projectId, the tool would fall back to the internal project — wrong target.
  const tools = options?.projectId
    ? ["update-dashboard", "patch-dashboard", "sql-query"]
    : ["update-dashboard", "patch-dashboard"];

  const chunkStream = await sendAiStreamRequest(
    backendBaseUrl,
    currentUser,
    {
      quality: "smart",
      speed: "slow",
      systemPrompt: "create-dashboard",
      tools,
      messages: [...contextMessages, ...messages],
      projectId: options?.projectId,
    },
    options?.abortSignal,
  );

  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    if (options?.abortSignal?.aborted) return;
    yield sanitizeAiContent(uiPartsToChatContent(message.parts));
  }
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
    projectId?: string,
  },
): Promise<{ content: ChatContent, toolCall: ToolCallContent | undefined }> {
  const contextMessages = await buildDashboardMessages(
    backendBaseUrl,
    currentUser,
    messages,
    options?.currentTsxSource,
    options?.enabledAppIds,
  );
  const tools = options?.projectId
    ? ["update-dashboard", "patch-dashboard", "sql-query"]
    : ["update-dashboard", "patch-dashboard"];
  const rawContent = await sendAiRequest(
    backendBaseUrl,
    currentUser,
    {
      quality: "smart",
      speed: "slow",
      systemPrompt: "create-dashboard",
      tools,
      messages: [...contextMessages, ...messages],
      projectId: options?.projectId,
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
  onRunStart?: () => void,
  onRunEnd?: () => void,
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }: ChatModelRunOptions) {
      onRunStart?.();
      try {
        const formattedMessages = formatThreadMessagesForBackend(messages);

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
      } finally {
        onRunEnd?.();
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
  projectId?: string,
  onRunStart?: () => void,
  onRunEnd?: () => void,
  onPatchApplied?: (updatedSource: string, failures: DashboardPatchFailure[], snapshots: DashboardPatchSnapshot[]) => void,
  getPendingChips?: () => DashboardChip[],
  consumePendingChips?: () => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      onRunStart?.();
      try {
        const formattedMessages = formatThreadMessagesForBackend(messages);
        const chips = getPendingChips?.() ?? [];
        if (chips.length > 0) {
          const chipBlock = chips.map((c) => {
            if (c.kind === "widget") {
              return `[Widget: ${c.name}]\nPath: ${c.selectorPath}\nHTML: ${c.outerHTMLSnippet}`;
            }
            if (c.kind === "action-add-component") {
              return `[Action: Add a new component to the dashboard]`;
            }
            // Bound stack/componentStack so a 5KB trace can't blow up the prompt.
            const stackSlice = c.stack ? `\nStack:\n${c.stack.slice(0, 1200)}` : "";
            const componentStackSlice = c.componentStack
              ? `\nComponent stack:${c.componentStack.slice(0, 400)}`
              : "";
            return `[Error: The dashboard crashed at runtime — please diagnose and fix.]\nMessage: ${c.message}${stackSlice}${componentStackSlice}`;
          }).join("\n\n");

          for (let i = formattedMessages.length - 1; i >= 0; i--) {
            if (formattedMessages[i].role !== "user") continue;
            const orig = formattedMessages[i].content;
            const chipPart = { type: "text" as const, text: chipBlock };
            formattedMessages[i] = {
              ...formattedMessages[i],
              content: Array.isArray(orig) ? [chipPart, ...orig] : [chipPart],
            };
            break;
          }
        }

        let latestContent: ChatContent = [];
        let chipsConsumed = chips.length === 0;
        for await (const content of streamDashboardCode(
          backendBaseUrl,
          currentUser,
          formattedMessages,
          {
            currentTsxSource,
            abortSignal,
            enabledAppIds,
            projectId,
          },
        )) {
          if (!chipsConsumed) {
            consumePendingChips?.();
            chipsConsumed = true;
          }
          latestContent = content;
          yield { content };
        }

        let runningSource = currentTsxSource;
        let lastFullReplacement: ToolCallContent | null = null;
        const aggregatedFailures: DashboardPatchFailure[] = [];
        const snapshots: DashboardPatchSnapshot[] = [];
        let anyPatchApplied = false;

        for (const item of latestContent) {
          if (!isToolCall(item)) continue;
          if (item.toolName === "updateDashboard") {
            if (typeof item.args?.content === "string") {
              runningSource = item.args.content;
              lastFullReplacement = item;
            }
          } else if (item.toolName === "patchDashboard") {
            const edits = parsePatchEdits(item.args);
            if (!edits) continue;
            const result = applyDashboardPatches(runningSource, edits);
            runningSource = result.updatedSource;
            anyPatchApplied = true;
            snapshots.push({ edits, resultSource: runningSource });
            for (const f of result.failures) {
              aggregatedFailures.push(f);
            }
          }
        }

        if (lastFullReplacement) {
          onToolCall(lastFullReplacement);
        }
        if (anyPatchApplied || aggregatedFailures.length > 0) {
          onPatchApplied?.(runningSource, aggregatedFailures, snapshots);
        }
      } catch (error) {
        if (abortSignal.aborted) {
          return;
        }
        throw new Error("Failed to get AI response. Please try again.");
      } finally {
        onRunEnd?.();
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

  if (!response.ok) {
    throw new Error(`Wysiwyg edit request failed: ${response.status} ${response.statusText}`);
  }

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
