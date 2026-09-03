import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { McpCallLogRow } from "../types";
import { toDate } from "../utils";
import { Badge, Button, cn } from "./design";
import { markdownComponents } from "./markdown-components";

const microLabelClasses = "text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

type ToolCall = {
  type: string;
  toolName: string;
  toolCallId: string;
  args: unknown;
  result: unknown;
};

type QaStep = {
  step: number;
  text?: string;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
  toolResults?: Array<{ toolName: string; toolCallId: string; result: unknown }>;
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:transition-none hover:bg-foreground/[0.06] hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, (err) => {
          console.error("Clipboard write failed:", err);
        });
      }}
    >
      <span className="text-[10px]">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

export function ToolCallCard({ call, accent = "purple" }: { call: { toolName: string; args: unknown; result: unknown }; accent?: "purple" | "indigo" }) {
  const [expanded, setExpanded] = useState(false);
  const colors = accent === "indigo"
    ? { dot: "text-chart-2", name: "text-chart-2", bg: "bg-chart-2/[0.08]", ring: "ring-chart-2/20" }
    : { dot: "text-chart-1", name: "text-chart-1", bg: "bg-panel-raised", ring: "ring-transparent" };

  return (
    <div className={cn("overflow-hidden rounded-lg ring-1", colors.bg, colors.ring)}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:transition-none hover:bg-panel-raised"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={cn("text-xs", colors.dot)}>&#9673;</span>
        <span className={cn("flex-1 font-mono text-xs font-medium", colors.name)}>{call.toolName}</span>
        <span className="text-[10px] text-muted-foreground">{expanded ? "collapse" : "expand"}</span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 pb-3 pt-1">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={microLabelClasses}>Args</span>
              <CopyButton text={JSON.stringify(call.args, null, 2)} />
            </div>
            <pre className="max-h-32 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={microLabelClasses}>Result</span>
              <CopyButton text={typeof call.result === "string" ? call.result : JSON.stringify(call.result, null, 2)} />
            </div>
            <pre className="max-h-32 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-surface px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
              {typeof call.result === "string" ? call.result.slice(0, 500) : JSON.stringify(call.result, null, 2).slice(0, 500)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5 justify-end">
      <div className="max-w-[80%] rounded-xl bg-chart-1/10 px-3.5 py-2 text-foreground">
        <p className="break-words text-[12px] leading-relaxed">{text}</p>
      </div>
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chart-1/15">
        <span className="text-[11px] font-semibold text-chart-1">U</span>
      </div>
    </div>
  );
}

export function AssistantBubble({ content, toolCalls }: { content: string; toolCalls: ToolCall[] }) {
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chart-1/15">
        <span className="text-xs font-bold text-chart-1">AI</span>
      </div>
      <div className="min-w-0 max-w-[calc(100%-2rem)] flex flex-col gap-2">
        {toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {toolCalls.map((call, i) => (
              <ToolCallCard key={call.toolCallId || String(i)} call={call} />
            ))}
          </div>
        )}
        {content && (
          <div className="rounded-xl bg-panel-raised px-3.5 py-2">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function QaReviewerBubble({ content, toolCalls, score }: { content: string; toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>; score?: number }) {
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-chart-2/15">
        <span className="text-[11px] font-semibold text-chart-2">QA</span>
      </div>
      <div className="min-w-0 max-w-[calc(100%-2rem)] flex flex-col gap-2">
        {toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {toolCalls.map((call, i) => (
              <ToolCallCard key={String(i)} call={call} accent="indigo" />
            ))}
          </div>
        )}
        {content && (
          <div className="rounded-xl bg-chart-2/[0.08] px-3.5 py-2">
            <p className="whitespace-pre-wrap text-[12px] text-foreground">{content.slice(0, 300)}{content.length > 300 ? "..." : ""}</p>
          </div>
        )}
        {score != null && (
          <div className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold tabular-nums",
            score >= 80
              ? "bg-success/12 text-success"
              : score >= 50
                ? "bg-warning/12 text-warning"
                : "bg-destructive/12 text-destructive",
          )}>
            Score: {score}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ label = "Thinking...", color = "purple" }: { label?: string; color?: "purple" | "indigo" }) {
  const bgColor = color === "indigo" ? "bg-chart-2/15" : "bg-chart-1/15";
  const textColor = color === "indigo" ? "text-chart-2" : "text-chart-1";
  const dotColor = color === "indigo" ? "bg-chart-2" : "bg-chart-1";
  const avatarText = color === "indigo" ? "QA" : "AI";

  return (
    <div className="flex gap-2.5 justify-start">
      <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full", bgColor)}>
        <span className={cn("text-xs font-bold", textColor)}>{avatarText}</span>
      </div>
      <div className="rounded-xl bg-panel-raised px-3.5 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex gap-0.5">
            <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full", dotColor)} />
            <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full", dotColor)} style={{ animationDelay: "150ms" }} />
            <span className={cn("h-1.5 w-1.5 animate-pulse rounded-full", dotColor)} style={{ animationDelay: "300ms" }} />
          </span>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function Divider({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-chart-2/30" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-chart-2">{text}</span>
      <div className="h-px flex-1 bg-chart-2/30" />
    </div>
  );
}

function CallDivider({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Call {current} of {total}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── Per-call data ──────────────────────────────────────

function parseCallData(row: McpCallLogRow) {
  let toolCalls: ToolCall[] = [];
  try {
    toolCalls = JSON.parse(row.innerToolCallsJson) as ToolCall[];
  } catch {
    // ignore
  }

  let qaSteps: QaStep[] = [];
  try {
    if (row.qaConversationJson) {
      qaSteps = JSON.parse(row.qaConversationJson) as QaStep[];
    }
  } catch {
    // ignore
  }

  const qaToolCalls = qaSteps.flatMap(s =>
    (s.toolCalls ?? []).map((tc, i) => ({
      toolName: tc.toolName,
      args: tc.args,
      result: s.toolResults?.[i]?.result ?? null,
    }))
  );
  const qaVerdictText = qaSteps.find(s => s.text && !s.toolCalls?.length)?.text ?? "";
  const hasQa = qaSteps.length > 0;

  const responseWords = row.response.split(/(\s+)/);
  const totalWords = responseWords.filter(w => w.trim()).length;

  const qaVerdictWords = qaVerdictText.split(/(\s+)/);
  const totalQaWords = qaVerdictWords.filter(w => w.trim()).length;

  return { toolCalls, qaToolCalls, qaVerdictText, qaVerdictWords, hasQa, responseWords, totalWords, totalQaWords };
}

// ─── Phases ─────────────────────────────────────────────

type ReplayPhase =
  | "idle" | "question" | "thinking" | "tools" | "response"
  | "qa-divider" | "qa-thinking" | "qa-tools" | "qa-verdict"
  | "call-divider"
  | "done";

// ─── Main Component ─────────────────────────────────────

export function ConversationReplay({ row, allRows, onClose }: { row: McpCallLogRow; allRows: McpCallLogRow[]; onClose: () => void }) {
  const conversationRows = useMemo(() => {
    if (row.conversationId) {
      const related = allRows
        .filter(r => r.conversationId === row.conversationId)
        .sort((a, b) => Number(toDate(a.createdAt)) - Number(toDate(b.createdAt)));
      if (related.length > 1) return related;
    }
    return [row];
  }, [row, allRows]);

  const [phase, setPhase] = useState<ReplayPhase>("idle");
  const [callIndex, setCallIndex] = useState(0);
  const [visibleToolCount, setVisibleToolCount] = useState(0);
  const [revealedWords, setRevealedWords] = useState(0);
  const [qaVisibleToolCount, setQaVisibleToolCount] = useState(0);
  const [qaRevealedWords, setQaRevealedWords] = useState(0);
  // Track completed calls for rendering
  const [completedCalls, setCompletedCalls] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentRow = conversationRows[callIndex] ?? conversationRows[0];
  const callData = useMemo(() => parseCallData(currentRow), [currentRow]);
  const isMultiCall = conversationRows.length > 1;

  const getPartialText = useCallback((words: string[], revealed: number) => {
    let wordCount = 0;
    let result = "";
    for (const part of words) {
      if (part.trim()) {
        wordCount++;
        if (wordCount > revealed) break;
      }
      result += part;
    }
    return result;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  // Phase sequencer
  useEffect(() => {
    if (phase === "idle" || phase === "done") return;

    if (phase === "question") {
      const timer = setTimeout(() => {
        setPhase("thinking");
        scrollToBottom();
      }, 800);
      return () => clearTimeout(timer);
    }
    if (phase === "thinking") {
      const timer = setTimeout(() => {
        setPhase(callData.toolCalls.length > 0 ? "tools" : "response");
        scrollToBottom();
      }, 1200);
      return () => clearTimeout(timer);
    }
    if (phase === "tools") {
      if (visibleToolCount < callData.toolCalls.length) {
        const timer = setTimeout(() => {
          setVisibleToolCount(prev => prev + 1);
          scrollToBottom();
        }, 600);
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => {
        setPhase("response");
        scrollToBottom();
      }, 400);
      return () => clearTimeout(timer);
    }
    if (phase === "response") {
      if (revealedWords < callData.totalWords) {
        const timer = setTimeout(() => {
          setRevealedWords(prev => Math.min(prev + 3, callData.totalWords));
          scrollToBottom();
        }, 20);
        return () => clearTimeout(timer);
      }
      if (callData.hasQa) {
        const timer = setTimeout(() => {
          setPhase("qa-divider");
          scrollToBottom();
        }, 600);
        return () => clearTimeout(timer);
      }
      // No QA — go to next call or done
      if (callIndex < conversationRows.length - 1) {
        const timer = setTimeout(() => {
          setPhase("call-divider");
          scrollToBottom();
        }, 400);
        return () => clearTimeout(timer);
      }
      setPhase("done");
      return;
    }
    if (phase === "qa-divider") {
      const timer = setTimeout(() => {
        setPhase("qa-thinking");
        scrollToBottom();
      }, 500);
      return () => clearTimeout(timer);
    }
    if (phase === "qa-thinking") {
      const timer = setTimeout(() => {
        setPhase(callData.qaToolCalls.length > 0 ? "qa-tools" : "qa-verdict");
        scrollToBottom();
      }, 800);
      return () => clearTimeout(timer);
    }
    if (phase === "qa-tools") {
      if (qaVisibleToolCount < callData.qaToolCalls.length) {
        const timer = setTimeout(() => {
          setQaVisibleToolCount(prev => prev + 1);
          scrollToBottom();
        }, 600);
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => {
        setPhase("qa-verdict");
        scrollToBottom();
      }, 400);
      return () => clearTimeout(timer);
    }
    if (phase === "qa-verdict") {
      if (qaRevealedWords < callData.totalQaWords) {
        const timer = setTimeout(() => {
          setQaRevealedWords(prev => Math.min(prev + 3, callData.totalQaWords));
          scrollToBottom();
        }, 20);
        return () => clearTimeout(timer);
      }
      if (callIndex < conversationRows.length - 1) {
        const timer = setTimeout(() => {
          setPhase("call-divider");
          scrollToBottom();
        }, 400);
        return () => clearTimeout(timer);
      }
      setPhase("done");
      return;
    }
    // phase === "call-divider"
    {
      const timer = setTimeout(() => {
        setCompletedCalls(callIndex + 1);
        setCallIndex(prev => prev + 1);
        setVisibleToolCount(0);
        setRevealedWords(0);
        setQaVisibleToolCount(0);
        setQaRevealedWords(0);
        setPhase("question");
        scrollToBottom();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [phase, visibleToolCount, revealedWords, qaVisibleToolCount, qaRevealedWords, callData, callIndex, conversationRows.length, scrollToBottom]);

  const startReplay = () => {
    setPhase("question");
    setCallIndex(0);
    setCompletedCalls(0);
    setVisibleToolCount(0);
    setRevealedWords(0);
    setQaVisibleToolCount(0);
    setQaRevealedWords(0);
  };

  const skipToEnd = () => {
    setPhase("done");
    setCallIndex(conversationRows.length - 1);
    setCompletedCalls(conversationRows.length);
    setVisibleToolCount(999);
    setRevealedWords(999);
    setQaVisibleToolCount(999);
    setQaRevealedWords(999);
  };

  const showQaSection = phase === "qa-divider" || phase === "qa-thinking" || phase === "qa-tools" || phase === "qa-verdict";
  const isActiveOrDone = phase !== "idle";

  // Aggregate stats
  const totalSteps = conversationRows.reduce((sum, r) => sum + r.stepCount, 0);
  const totalDuration = conversationRows.reduce((sum, r) => sum + Number(r.durationMs), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-surface-overlay text-foreground shadow-2xl ring-1 ring-inset ring-border-strong">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {isMultiCall ? "Conversation Replay" : "Call Replay"}
            </h2>
            <Badge>{isMultiCall ? `${conversationRows.length} calls` : currentRow.toolName}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {phase === "idle" && (
              <Button variant="default" onClick={startReplay}>Play</Button>
            )}
            {phase !== "idle" && phase !== "done" && (
              <Button onClick={skipToEnd}>Skip</Button>
            )}
            {phase === "done" && (
              <Button onClick={startReplay}>Replay</Button>
            )}
            <Button variant="ghost" onClick={onClose}>close</Button>
          </div>
        </div>

        {/* Conversation area */}
        <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {phase === "idle" && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Click Play to replay this {isMultiCall ? "conversation" : "call"}
            </div>
          )}

          {isActiveOrDone && (
            <>
              {/* Completed calls */}
              {Array.from({ length: phase === "done" ? conversationRows.length : completedCalls }).map((_, i) => {
                const r = conversationRows[i];
                const d = parseCallData(r);
                return (
                  <div key={String(r.id)} className="space-y-4">
                    {i > 0 && <CallDivider current={i + 1} total={conversationRows.length} />}
                    {r.userPrompt && (
                      <div className="text-center">
                        <span className={microLabelClasses}>Original Prompt</span>
                        <p className="mt-0.5 text-xs text-muted-foreground">{r.userPrompt}</p>
                      </div>
                    )}
                    <UserBubble text={r.question} />
                    <AssistantBubble content={r.response} toolCalls={d.toolCalls} />
                    {d.hasQa && (
                      <>
                        <Divider text="AI QA Review" />
                        <QaReviewerBubble
                          content={d.qaVerdictText}
                          toolCalls={d.qaToolCalls}
                          score={r.qaOverallScore ?? undefined}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {/* Current call being animated (only if not done) */}
              {phase !== "done" && (
                <div className="space-y-4">
                  {callIndex > 0 && callIndex > completedCalls - 1 && (
                    <CallDivider current={callIndex + 1} total={conversationRows.length} />
                  )}

                  {currentRow.userPrompt && (
                    <div className="text-center">
                      <span className={microLabelClasses}>Original Prompt</span>
                      <p className="mt-0.5 text-xs text-muted-foreground">{currentRow.userPrompt}</p>
                    </div>
                  )}

                  <UserBubble text={currentRow.question} />

                  {phase === "thinking" && <ThinkingIndicator />}

                  {(phase === "tools" || phase === "response" || showQaSection || phase === "call-divider") && (
                    <AssistantBubble
                      content={
                        phase === "tools" ? "" :
                          showQaSection || phase === "call-divider" ? currentRow.response :
                        getPartialText(callData.responseWords, revealedWords)
                      }
                      toolCalls={callData.toolCalls.slice(0, phase === "tools" ? visibleToolCount : callData.toolCalls.length)}
                    />
                  )}

                  {(showQaSection || phase === "call-divider") && callData.hasQa && (
                    <>
                      <Divider text="AI QA Review" />
                      {phase === "qa-thinking" && <ThinkingIndicator label="Reviewing..." color="indigo" />}
                      {(phase === "qa-tools" || phase === "qa-verdict" || phase === "call-divider") && (
                        <QaReviewerBubble
                          content={
                            phase === "qa-tools" ? "" :
                              phase === "call-divider" ? callData.qaVerdictText :
                            getPartialText(callData.qaVerdictWords, qaRevealedWords)
                          }
                          toolCalls={callData.qaToolCalls.slice(0, phase === "qa-tools" ? qaVisibleToolCount : callData.qaToolCalls.length)}
                          score={phase === "call-divider" ? currentRow.qaOverallScore ?? undefined : undefined}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            {totalSteps} step{totalSteps !== 1 ? "s" : ""} {"\u00B7"} {totalDuration.toLocaleString()}ms
            {isMultiCall && ` \u00B7 ${conversationRows.length} calls`}
          </span>
          <span>{currentRow.modelId}</span>
        </div>
      </div>
    </div>
  );
}
