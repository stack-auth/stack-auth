import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AiQueryLogRow } from "../types";
import { toDate } from "../utils";
import { AssistantBubble, ToolCallCard, UserBubble } from "./ConversationReplay";
import { Alert, Badge, Button } from "./design";
import { markdownComponents } from "./markdown-components";

const sectionLabelClasses = "text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

type MessageIn = {
  role: "user" | "assistant" | "tool",
  content: unknown,
};

type StepEntry = {
  step: number,
  text?: string,
  toolCalls?: Array<{ toolName: string, toolCallId: string, args: unknown }>,
  toolResults?: Array<{ toolName: string, toolCallId: string, result: unknown }>,
};

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text ?? "");
        return JSON.stringify(part);
      })
      .join("");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

export function UsageDetail({ row, onClose }: { row: AiQueryLogRow, onClose: () => void }) {
  const messages: MessageIn[] = useMemo(() => {
    try {
      const parsed = JSON.parse(row.messagesJson);
      return Array.isArray(parsed) ? parsed as MessageIn[] : [];
    } catch {
      return [];
    }
  }, [row.messagesJson]);

  const steps: StepEntry[] = useMemo(() => {
    try {
      const parsed = JSON.parse(row.stepsJson);
      return Array.isArray(parsed) ? parsed as StepEntry[] : [];
    } catch {
      return [];
    }
  }, [row.stepsJson]);

  const requestedTools: string[] = useMemo(() => {
    try {
      const parsed = JSON.parse(row.requestedToolsJson);
      return Array.isArray(parsed) ? parsed as string[] : [];
    } catch {
      return [];
    }
  }, [row.requestedToolsJson]);

  const assistantBubbles = steps.map((s, i) => {
    const toolCalls = (s.toolCalls ?? []).map((tc, idx) => {
      const matched = s.toolResults?.find(r => r.toolCallId === tc.toolCallId) ?? s.toolResults?.[idx];
      return {
        type: "tool-call",
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.args,
        result: matched?.result ?? null,
      };
    });
    return { key: i, text: s.text ?? "", toolCalls };
  });

  const isError = row.errorMessage != null && row.errorMessage !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3 dark:border-white/[0.06]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color="purple" size="xs" mono>{row.systemPromptId}</Badge>
            <Badge color="blue" size="xs" mono>{row.modelId}</Badge>
            <Badge size="xs">{row.mode}</Badge>
            {isError && <Badge color="red" size="xs">error</Badge>}
            {row.conversationId != null && <Badge color="orange" size="xs">MCP</Badge>}
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {toDate(row.createdAt).toLocaleString()}
            {" · "}{Number(row.durationMs).toLocaleString()}ms
            {" · "}in {row.inputTokens?.toLocaleString() ?? "?"} tok
            {(() => {
              const r = row.cachedInputTokens ?? 0;
              const w = row.cacheCreationTokens ?? 0;
              if (r === 0 && w === 0) return null;
              const parts: string[] = [];
              if (r > 0) parts.push(`r ${r.toLocaleString()}`);
              if (w > 0) parts.push(`w ${w.toLocaleString()}`);
              return <> (cache {parts.join(", ")})</>;
            })()}
            {" · "}out {row.outputTokens?.toLocaleString() ?? "?"} tok
            {row.costUsd != null && <>{" · "}${row.costUsd.toFixed(4)}</>}
            {(() => {
              const savings = row.cacheDiscountUsd;
              if (savings == null) return null;
              const sign = savings >= 0 ? "+" : "−";
              const color = savings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
              return <>{" · "}<span className={color}>cache {sign}${Math.abs(savings).toFixed(4)}</span></>;
            })()}
          </p>
        </div>
        <Button variant="ghost" className="ml-2 shrink-0" onClick={onClose}>✕</Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isError && (
          <Alert className="mx-4 mt-4 p-3">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider">Error</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{row.errorMessage}</pre>
          </Alert>
        )}

        {/* Metadata panel */}
        <div className="m-4 space-y-1 rounded-lg bg-foreground/[0.04] p-3 text-xs">
          <MetaRow label="Quality / Speed" value={`${row.quality} / ${row.speed}`} />
          <MetaRow label="Authed" value={row.isAuthenticated ? "yes" : "no"} />
          {row.projectId && <MetaRow label="Project" value={row.projectId} />}
          {row.userId && <MetaRow label="User" value={row.userId} />}
          {row.conversationId && <MetaRow label="Conversation" value={row.conversationId} />}
          <MetaRow label="Steps" value={String(row.stepCount)} />
          <MetaRow label="Tools requested" value={requestedTools.length > 0 ? requestedTools.join(", ") : "—"} />
        </div>

        {/* Conversation replay */}
        <div className="px-4 pb-6 space-y-3">
          <h3 className={sectionLabelClasses}>Input Messages</h3>
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">No input messages.</p>
          )}
          {messages.map((m, i) => {
            const text = messageContentToText(m.content);
            if (m.role === "user") {
              return <UserBubble key={`in-${i}`} text={text} />;
            }
            if (m.role === "assistant") {
              return <AssistantBubble key={`in-${i}`} content={text} toolCalls={[]} />;
            }
            return (
              <div key={`in-${i}`} className="flex gap-2.5 justify-start">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground/10">
                  <span className="text-[10px] font-bold text-muted-foreground">T</span>
                </div>
                <div className="max-w-[80%] rounded-xl bg-foreground/[0.04] px-3.5 py-2">
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{text}</pre>
                </div>
              </div>
            );
          })}

          <h3 className={`${sectionLabelClasses} pt-2`}>Assistant Steps</h3>
          {assistantBubbles.length === 0 && (
            <p className="text-xs text-muted-foreground">No assistant output recorded.</p>
          )}
          {assistantBubbles.map(bubble => (
            <div key={bubble.key} className="space-y-1.5">
              {bubble.toolCalls.length > 0 && (
                <div className="space-y-1.5">
                  {bubble.toolCalls.map((call, i) => (
                    <ToolCallCard key={call.toolCallId || String(i)} call={call} />
                  ))}
                </div>
              )}
              {bubble.text && (
                <div className="flex gap-2.5 justify-start">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/15">
                    <span className="text-xs font-bold text-purple-600 dark:text-purple-400">AI</span>
                  </div>
                  <div className="min-w-0 max-w-[calc(100%-2rem)] rounded-xl bg-foreground/[0.04] px-3.5 py-2">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {bubble.text}
                    </Markdown>
                  </div>
                </div>
              )}
            </div>
          ))}

          {row.finalText && assistantBubbles.length === 0 && (
            <>
              <h3 className={`${sectionLabelClasses} pt-2`}>Final Response</h3>
              <div className="rounded-xl bg-blue-500/10 px-3.5 py-2">
                <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {row.finalText}
                </Markdown>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex gap-2">
      <span className={`${sectionLabelClasses} w-32 shrink-0`}>{label}</span>
      <span className="break-all font-mono text-foreground">{value}</span>
    </div>
  );
}
