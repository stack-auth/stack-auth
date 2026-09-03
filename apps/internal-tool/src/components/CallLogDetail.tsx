import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { format, formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { McpCallLogRow, QaEntriesRow } from "../types";
import { QA_REVIEW_FAILED_THRESHOLD_MS, qaReviewStartedAt, toDate } from "../utils";
import { ConversationReplay } from "./ConversationReplay";
import { Alert, Badge, Button, cn, Input, Textarea } from "./design";
import { markdownComponents } from "./markdown-components";

/** Panel surface for the detail cards — same translucent treatment as the design Card, tint-able. */
const panelClasses = "overflow-hidden rounded-2xl bg-panel ring-1 ring-inset ring-transparent";
const sectionLabelClasses = "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint";

// ─── Shared ────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ml-2 text-xs text-muted-foreground transition-colors hover:transition-none hover:text-foreground"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }, (err) => {
          console.error("Clipboard write failed:", err);
        });
      }}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

// ─── Main Component ────────────────────────────────────

export function CallLogDetail({ row, allRows, qaEntries, onClose, onSaveCorrection, onSetReviewed, onRetryReview }: {
  row: McpCallLogRow;
  allRows: McpCallLogRow[];
  qaEntries: QaEntriesRow[];
  onClose: () => void;
  onSaveCorrection?: (correlationId: string, correctedQuestion: string, correctedAnswer: string, publish: boolean) => Promise<void> | void;
  onSetReviewed?: (correlationId: string, reviewed: boolean) => Promise<void> | void;
  onRetryReview?: (correlationId: string, payload: { question: string; reason: string; response: string }) => Promise<void> | void;
}) {
  const linkedQa = qaEntries.find(q => q.sourceMcpCorrelationId === row.correlationId);
  const [showReplay, setShowReplay] = useState(false);
  // Optimistic override while the reviewed-state roundtrip is in flight. Cleared
  // once the real subscription update catches up.
  const [optimisticReviewed, setOptimisticReviewed] = useState<boolean | null>(null);
  useEffect(() => {
    const actual = row.humanReviewedAt != null;
    if (optimisticReviewed != null && optimisticReviewed === actual) {
      setOptimisticReviewed(null);
    }
  }, [row.humanReviewedAt, optimisticReviewed]);
  const isReviewed = optimisticReviewed ?? (row.humanReviewedAt != null);

  const handleSetReviewed = (reviewed: boolean) => {
    const previous = optimisticReviewed;
    setOptimisticReviewed(reviewed);
    runAsynchronouslyWithAlert(
      Promise.resolve(onSetReviewed?.(row.correlationId, reviewed)).catch(err => {
        // Revert the optimistic override so the UI reflects the database's real state.
        setOptimisticReviewed(previous);
        captureError("call-log-set-reviewed", err);
        throw err;
      })
    );
  };

  return (
    <div className="p-4 space-y-4">
      {showReplay && (
        <ConversationReplay row={row} allRows={allRows} onClose={() => setShowReplay(false)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Call Detail</h2>
          {isReviewed && (
            <Badge color="green" title={row.humanReviewedAt ? format(toDate(row.humanReviewedAt), "PPpp") : undefined}>
              &#10003; Reviewed
              {row.humanReviewedBy ? ` by ${row.humanReviewedBy}` : ""}
              {row.humanReviewedAt
                ? ` · ${formatDistanceToNow(toDate(row.humanReviewedAt), { addSuffix: true })}`
                : " · just now"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isReviewed && onSetReviewed && (
            <Button onClick={() => handleSetReviewed(true)}>Mark as reviewed</Button>
          )}
          {isReviewed && onSetReviewed && (
            <Button onClick={() => handleSetReviewed(false)}>Unmark</Button>
          )}
          <Button onClick={() => setShowReplay(true)}>Replay</Button>
          <Button variant="ghost" onClick={onClose}>close</Button>
        </div>
      </div>

      {/* Card 1: MCP Call */}
      <MpcCallCard row={row} />

      {/* Card 2: AI QA Review */}
      <QaReviewCard row={row} onRetryReview={onRetryReview} />

      {/* Card 3: Human Correction */}
      <HumanCorrectionCard row={row} qa={linkedQa} onSave={onSaveCorrection} />
    </div>
  );
}

// ─── Card 1: MCP Call ──────────────────────────────────

function MpcCallCard({ row }: { row: McpCallLogRow }) {
  const [toolsExpanded, setToolsExpanded] = useState(true);

  let toolCalls: Array<{ type: string; toolName: string; toolCallId: string; args: unknown; result: unknown }> = [];
  try {
    toolCalls = JSON.parse(row.innerToolCallsJson) as typeof toolCalls;
  } catch {
    // ignore
  }

  return (
    <div className={panelClasses}>
      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Badge color="purple">{row.toolName}</Badge>
        <span title={format(toDate(row.createdAt), "PPpp")}>
          {formatDistanceToNow(toDate(row.createdAt), { addSuffix: true })}
        </span>
        <span>{Number(row.durationMs).toLocaleString()}ms</span>
        <span>{row.stepCount} step{row.stepCount !== 1 ? "s" : ""}</span>
        <span className="font-mono">{row.modelId}</span>
      </div>

      <div className="p-4 space-y-3">
        {row.errorMessage && (
          <Alert className="p-2 text-sm">{row.errorMessage}</Alert>
        )}

        {/* User Prompt */}
        {row.userPrompt && (
          <div>
            <h4 className={cn(sectionLabelClasses, "mb-0.5")}>User Prompt</h4>
            <p className="text-sm text-foreground">{row.userPrompt}</p>
          </div>
        )}

        {/* Reason */}
        <p className="text-xs italic text-muted-foreground">{row.reason}</p>

        {/* Question */}
        <div>
          <div className="flex items-center mb-1">
            <h4 className={sectionLabelClasses}>Question</h4>
            <CopyButton text={row.question} />
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{row.question}</p>
        </div>

        {/* Response */}
        <div>
          <div className="flex items-center mb-1">
            <h4 className={sectionLabelClasses}>AI Response</h4>
            <CopyButton text={row.response} />
          </div>
          <div className="max-h-64 overflow-auto rounded-lg bg-panel-raised p-3 text-sm">
            {row.response ? (
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {row.response}
              </Markdown>
            ) : <span className="text-muted-foreground">(empty)</span>}
          </div>
        </div>

        {/* Tool Calls */}
        {toolCalls.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:transition-none hover:text-foreground"
              onClick={() => setToolsExpanded(prev => !prev)}
            >
              <span className="text-[10px]">{toolsExpanded ? "▾" : "▸"}</span>
              Tool Calls ({toolCalls.length})
            </button>
            {toolsExpanded && (
              <div className="mt-2 space-y-2">
                {toolCalls.map((call, i) => (
                  <InnerToolCall key={call.toolCallId || String(i)} call={call} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InnerToolCall({ call }: { call: { toolName: string; toolCallId: string; args: unknown; result: unknown } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-xl bg-panel-raised">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors hover:transition-none hover:bg-muted"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="font-mono text-xs">
          <span className="text-chart-1">{call.toolName}</span>
          <span className="ml-2 text-muted-foreground">#{call.toolCallId.slice(0, 8)}</span>
        </span>
        <span className="text-xs text-muted-foreground">{expanded ? "collapse" : "expand"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Args:</p>
            <pre className="max-h-40 overflow-auto rounded-lg bg-panel-raised p-2 text-xs">{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Result:</p>
            <pre className="max-h-40 overflow-auto rounded-lg bg-panel-raised p-2 text-xs">{JSON.stringify(call.result, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card 2: AI QA Review ──────────────────────────────

type QaFlag = { type: string; severity: string; explanation: string };

function RetryReviewButton({ row, onRetryReview, label = "Retry review", tone = "indigo" }: {
  row: McpCallLogRow;
  onRetryReview: (correlationId: string, payload: { question: string; reason: string; response: string }) => Promise<void> | void;
  label?: string;
  tone?: "indigo" | "red";
}) {
  const [retrying, setRetrying] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);

  return (
    <Button
      size="xs"
      variant={tone === "red" ? "destructive" : "outline"}
      disabled={retrying}
      onClick={() => {
        setRetrying(true);
        runAsynchronouslyWithAlert(
          Promise.resolve(onRetryReview(row.correlationId, { question: row.question, reason: row.reason, response: row.response }))
            .then(() => {
              setJustTriggered(true);
              setTimeout(() => setJustTriggered(false), 3000);
            })
            .catch(err => {
              captureError("call-log-retry-review", err);
              throw err;
            })
            .finally(() => setRetrying(false))
        );
      }}
    >
      {retrying ? "Retrying…" : justTriggered ? "Queued" : label}
    </Button>
  );
}

function QaReviewCard({ row, onRetryReview }: {
  row: McpCallLogRow;
  onRetryReview?: (correlationId: string, payload: { question: string; reason: string; response: string }) => Promise<void> | void;
}) {
  if (row.qaErrorMessage) {
    return (
      <Alert className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider">AI QA Review</h3>
          {onRetryReview && <RetryReviewButton row={row} onRetryReview={onRetryReview} tone="red" />}
        </div>
        <p className="whitespace-pre-wrap text-sm">Error: {row.qaErrorMessage}</p>
      </Alert>
    );
  }

  if (row.qaOverallScore == null) {
    const reviewStartedAt = qaReviewStartedAt(row);
    const ageMs = Date.now() - reviewStartedAt.getTime();
    const reviewFailed = ageMs > QA_REVIEW_FAILED_THRESHOLD_MS;

    if (reviewFailed) {
      return (
        <Alert variant="warning" className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider">AI QA Review</h3>
              <Badge color="orange">Review failed</Badge>
            </div>
            {onRetryReview && <RetryReviewButton row={row} onRetryReview={onRetryReview} />}
          </div>
          <p className="text-xs">
            No review completed in {formatDistanceToNow(reviewStartedAt)}. The reviewer was likely skipped (missing OpenRouter key) or the background task died — click retry to re-run.
          </p>
        </Alert>
      );
    }

    return (
      <div className={cn(panelClasses, "p-4")}>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">AI QA Review</h3>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-chart-2 border-t-transparent" />
          <span className="text-xs text-muted-foreground">Reviewing...</span>
        </div>
      </div>
    );
  }

  let flags: QaFlag[] = [];
  try {
    flags = JSON.parse(row.qaFlagsJson ?? "[]") as QaFlag[];
  } catch {
    // ignore
  }

  const scoreColor = row.qaOverallScore >= 80
    ? "text-success bg-success/12"
    : row.qaOverallScore >= 50
      ? "text-warning bg-warning/12"
      : "text-destructive bg-destructive/12";

  const lowSeverityClasses = "border-border bg-panel-raised";
  const severityClasses = new Map<string, string>([
    ["critical", "border-destructive bg-destructive/10"],
    ["high", "border-destructive/60 bg-destructive/[0.07]"],
    ["medium", "border-warning bg-warning/10"],
    ["low", lowSeverityClasses],
  ]);

  return (
    <div className={panelClasses}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground">AI QA Review</h3>
          {row.qaNeedsHumanReview && !row.humanReviewedAt && (
            <Badge color="orange">Needs Review</Badge>
          )}
        </div>
        <span className={cn("rounded-lg px-2 py-0.5 text-lg font-bold tabular-nums", scoreColor)}>
          {row.qaOverallScore}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {/* Badges */}
        <div className="flex gap-2">
          <Badge color={row.qaAnswerCorrect ? "green" : "red"}>
            {row.qaAnswerCorrect ? "correct" : "incorrect"}
          </Badge>
          <Badge color={row.qaAnswerRelevant ? "green" : "red"}>
            {row.qaAnswerRelevant ? "relevant" : "off-topic"}
          </Badge>
        </div>

        {/* Flags */}
        {flags.length > 0 && (
          <div className="space-y-1.5">
            {flags.map((flag, i) => (
              <div key={i} className={cn("rounded-r-lg border-l-4 py-1.5 pl-3 text-sm", severityClasses.get(flag.severity) ?? lowSeverityClasses)}>
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="font-mono text-xs text-foreground">{flag.type}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{flag.severity}</span>
                </div>
                <p className="text-xs text-muted-foreground">{flag.explanation}</p>
              </div>
            ))}
          </div>
        )}

        {/* Suggestions */}
        {row.qaImprovementSuggestions && (
          <div>
            <h4 className={cn(sectionLabelClasses, "mb-1")}>Suggestions</h4>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{row.qaImprovementSuggestions}</p>
          </div>
        )}

        {/* Conversation timeline */}
        {row.qaConversationJson && (
          <QaConversationTimeline json={row.qaConversationJson} />
        )}

        {/* Model */}
        {row.qaReviewModelId && (
          <p className="text-[10px] text-muted-foreground">by {row.qaReviewModelId}</p>
        )}
      </div>
    </div>
  );
}

// ─── Card 3: Human Correction ──────────────────────────

async function fetchDeepWikiAnswer(questionText: string): Promise<string> {
  const res = await fetch("https://mcp.deepwiki.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "ask_question",
        arguments: {
          repoName: "hexclave/hexclave",
          question: questionText,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepWiki error: ${res.status}`);
  }

  const rawText = await res.text();
  const dataLine = rawText.split("\n").find(line => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error("No data in DeepWiki response");
  }

  const data = JSON.parse(dataLine.slice(6)) as {
    result?: { content?: Array<{ text?: string }> };
  };

  return data.result?.content
    ?.filter((c): c is { text: string } => typeof c.text === "string")
    .map(c => c.text)
    .join("\n\n") ?? "(no response)";
}

function HumanCorrectionCard({ row, qa, onSave }: {
  row: McpCallLogRow;
  qa: QaEntriesRow | undefined;
  onSave?: (correlationId: string, correctedQuestion: string, correctedAnswer: string, publish: boolean) => Promise<void> | void;
}) {
  const persistedQuestion = qa?.question ?? "";
  const persistedAnswer = qa?.answer ?? "";
  const isPublished = qa?.published === true;
  const hasDraft = qa != null;

  const [question, setQuestion] = useState(persistedQuestion);
  const [answer, setAnswer] = useState(persistedAnswer);
  const [lastAction, setLastAction] = useState<"published" | "saved" | "deepwiki-error" | "error" | null>(null);
  const [deepWikiLoading, setDeepWikiLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setQuestion(persistedQuestion);
    setAnswer(persistedAnswer);
  }, [persistedQuestion, persistedAnswer, row.correlationId]);

  const handleSave = async (publish: boolean) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onSave?.(row.correlationId, question, answer, publish);
      setLastAction(publish ? "published" : "saved");
      setTimeout(() => setLastAction(null), 3000);
    } catch {
      setLastAction("error");
      setTimeout(() => setLastAction(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const hasUnsavedChanges =
    question !== persistedQuestion ||
    answer !== persistedAnswer;

  const saveAction = (() => {
    if (isSaving) return { label: "Saving…", isDraft: !isPublished, disabled: true };
    if (hasUnsavedChanges) return { label: "Save Draft", isDraft: true, disabled: false };
    if (!hasDraft) return { label: "Save Draft", isDraft: true, disabled: true };
    return { label: isPublished ? "Update" : "Publish", isDraft: false, disabled: false };
  })();

  // Subtle state tint on the card edge: published = green, unpublished draft = amber.
  const cardTint = isPublished
    ? "ring-success/25"
    : hasDraft
      ? "ring-warning/30"
      : "";

  return (
    <div className={cn(panelClasses, cardTint)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.09em] text-foreground">Human Correction</h3>
          {isPublished ? (
            <Badge color="green">&#10003; Published</Badge>
          ) : hasDraft ? (
            <Badge color="orange">Draft</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {qa?.lastPublishedAt && (
            <span>{format(toDate(qa.lastPublishedAt), "MMM d, yyyy")}</span>
          )}
          {qa?.lastEditedBy && (
            <span>by {qa.lastEditedBy}</span>
          )}
          {isPublished && (
            <button
              onClick={() => void handleSave(false)}
              className="text-destructive transition-colors hover:transition-none hover:text-destructive/80"
            >
              Unpublish
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Feedback toast */}
        {lastAction && (
          <div className={cn(
            "rounded-lg px-2.5 py-1 text-[11px] font-medium",
            lastAction === "published" ? "bg-success/12 text-success" :
              lastAction === "deepwiki-error" || lastAction === "error" ? "bg-destructive/12 text-destructive" :
                "bg-chart-1/12 text-chart-1"
          )}>
            {lastAction === "published" ? "Published to /questions" :
              lastAction === "deepwiki-error" ? "Failed to fetch from DeepWiki" :
                lastAction === "error" ? "Failed to save" :
                  "Draft saved"}
          </div>
        )}

        {/* Question */}
        <div>
          <label className={cn(sectionLabelClasses, "mb-1 block")}>Question</label>
          <Input
            type="text"
            className="h-9 px-3 text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="The question..."
          />
        </div>

        {/* Answer */}
        <div>
          <label className={cn(sectionLabelClasses, "mb-1 block")}>Answer</label>
          <Textarea
            className="h-40 resize-y px-3 py-2 font-mono text-sm"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the corrected answer..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setQuestion(row.question);
              setAnswer(row.response);
            }}
          >
            Pre-fill from call
          </Button>
          <Button
            disabled={deepWikiLoading}
            onClick={() => {
              const q = question || row.question;
              setDeepWikiLoading(true);
              fetchDeepWikiAnswer(q)
                .then(a => {
                  setAnswer(a);
                  if (!question) {
                    setQuestion(q);
                  }
                })
                .catch(() => setLastAction("deepwiki-error"))
                .finally(() => setDeepWikiLoading(false));
            }}
          >
            {deepWikiLoading ? "Fetching..." : "Pre-fill from DeepWiki"}
          </Button>
          {hasUnsavedChanges && (
            <span className="text-[10px] text-warning">unsaved changes</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={saveAction.isDraft ? "outline" : "default"}
              onClick={() => void handleSave(!hasUnsavedChanges)}
              disabled={saveAction.disabled}
            >
              {saveAction.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── QA Conversation Timeline ──────────────────────────

type QaStep = {
  step: number;
  text?: string;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
  toolResults?: Array<{ toolName: string; toolCallId: string; result: unknown }>;
};

function formatByteSize(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const bytes = new Blob([str]).size;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function QaConversationTimeline({ json }: { json: string }) {
  const [expanded, setExpanded] = useState(false);

  let steps: QaStep[];
  try {
    steps = JSON.parse(json) as QaStep[];
  } catch {
    return null;
  }

  if (steps.length === 0) return null;

  return (
    <div>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:transition-none hover:text-foreground"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
        Reviewer Conversation ({steps.length} step{steps.length !== 1 ? "s" : ""})
      </button>
      {expanded && (
        <div className="relative ml-1 mt-3 space-y-4 border-l-2 border-border">
          {steps.map((step) => {
            const hasTools = step.toolCalls && step.toolCalls.length > 0;
            return hasTools
              ? <QaToolStep key={step.step} step={step} />
              : step.text ? <QaConclusionStep key={step.step} step={step} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

function QaToolStep({ step }: { step: QaStep }) {
  const pairs = (step.toolCalls ?? []).map((tc, i) => ({
    toolName: tc.toolName,
    args: tc.args,
    result: step.toolResults?.[i]?.result ?? null,
  }));

  return (
    <div className="relative pl-5">
      <div className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-chart-2" />
      <p className={cn(sectionLabelClasses, "mb-1.5")}>
        Step {step.step} — Verification
      </p>
      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <QaToolCard key={i} pair={pair} />
        ))}
      </div>
      {step.text && (
        <div className="mt-2 rounded-lg bg-panel-raised p-2">
          <p className="whitespace-pre-wrap text-xs text-foreground">{step.text}</p>
        </div>
      )}
    </div>
  );
}

function QaToolCard({ pair }: { pair: { toolName: string; args: unknown; result: unknown } }) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const resultStr = pair.result == null
    ? null
    : typeof pair.result === "string" ? pair.result : JSON.stringify(pair.result, null, 2);

  return (
    <div className="overflow-hidden rounded-xl bg-panel">
      <div className="bg-chart-2/10 px-3 py-1.5">
        <span className="font-mono text-[11px] text-chart-2">{pair.toolName}</span>
      </div>
      <div className="border-t border-border px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className={sectionLabelClasses}>Args</p>
          <CopyButton text={JSON.stringify(pair.args, null, 2)} />
        </div>
        <pre className="max-h-24 overflow-auto text-xs text-muted-foreground">{JSON.stringify(pair.args, null, 2)}</pre>
      </div>
      {resultStr != null && (
        <div className="border-t border-border px-3 py-2">
          <div className={cn("flex w-full items-center justify-between", sectionLabelClasses)}>
            <button
              className="transition-colors hover:transition-none hover:text-foreground"
              onClick={() => setResultExpanded(prev => !prev)}
            >
              Result ({formatByteSize(pair.result)}) — {resultExpanded ? "collapse" : "expand"}
            </button>
            {resultExpanded && <CopyButton text={resultStr} />}
          </div>
          {resultExpanded && (
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{resultStr}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function QaConclusionStep({ step }: { step: QaStep }) {
  const [expanded, setExpanded] = useState(false);
  const text = step.text ?? "";
  const truncated = text.length > 150 ? text.slice(0, 150) + "..." : text;

  return (
    <div className="relative pl-5">
      <div className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-foreground/40" />
      <p className={cn(sectionLabelClasses, "mb-1.5")}>
        Step {step.step} — Conclusion
      </p>
      <div className="rounded-lg bg-panel-raised p-3">
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          {expanded ? text : truncated}
        </p>
        {text.length > 150 && (
          <button
            className="mt-1 text-xs text-muted-foreground transition-colors hover:transition-none hover:text-foreground"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? "show less" : "show full"}
          </button>
        )}
      </div>
    </div>
  );
}
