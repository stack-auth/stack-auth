"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
} from "@/components/design-components";
import { Input, Skeleton, Typography } from "@/components/ui";
import {
  fetchBrainQueue,
  fetchBrainState,
  postBrainMessage,
  retryBrainQueueItems,
  type BrainMessageDto,
  type BrainQueueItemDto,
  type BrainStateDto,
} from "@/lib/brain";
import { getAppStageLabel } from "@/lib/apps-utils";
import { cn } from "@/lib/utils";
import {
  ArrowClockwiseIcon,
  ListBulletsIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type LoadState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "ok", data: BrainStateDto };

function getObjectProperty(value: unknown, key: string): unknown {
  if (value == null || typeof value !== "object") return undefined;
  return Reflect.get(value, key);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => getObjectProperty(part, "type") === "text")
      .map((part) => getObjectProperty(part, "text"))
      .filter((text): text is string => typeof text === "string")
      .join("\n");
  }
  const text = getObjectProperty(content, "text");
  if (typeof text === "string") return text;
  return JSON.stringify(content, null, 2);
}

type ToolTrace = {
  key: string,
  name: string,
  input: unknown,
  output: unknown,
  status: "running" | "completed" | "failed" | "interrupted",
  durationMs: number | null,
  error: string | null,
};

function getLegacyToolTraces(content: unknown): ToolTrace[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part, index) => {
    if (getObjectProperty(part, "type") !== "tool-call") return [];
    const toolCallId = getObjectProperty(part, "toolCallId");
    const toolName = getObjectProperty(part, "toolName");
    const name = typeof toolName === "string" ? toolName : "Unknown tool";
    return [{
      key: typeof toolCallId === "string" ? toolCallId : `${name}-${index}`,
      name,
      input: getObjectProperty(part, "args"),
      output: getObjectProperty(part, "result"),
      status: "completed" as const,
      durationMs: null,
      error: null,
    }];
  });
}

function getPersistedToolTrace(message: BrainMessageDto): ToolTrace | null {
  if (message.role !== "tool" || getObjectProperty(message.content, "type") !== "tool-trace") {
    return null;
  }
  const toolCallId = getObjectProperty(message.content, "toolCallId");
  const toolName = getObjectProperty(message.content, "toolName");
  const status = getObjectProperty(message.content, "status");
  const durationMs = getObjectProperty(message.content, "durationMs");
  const error = getObjectProperty(message.content, "error");
  if (
    typeof toolName !== "string"
    || (
      status !== "running"
      && status !== "completed"
      && status !== "failed"
      && status !== "interrupted"
    )
  ) {
    return null;
  }
  return {
    key: typeof toolCallId === "string" ? toolCallId : message.id,
    name: toolName,
    input: getObjectProperty(message.content, "input"),
    output: getObjectProperty(message.content, "output"),
    status,
    durationMs: typeof durationMs === "number" ? durationMs : null,
    error: typeof error === "string" ? error : null,
  };
}

function formatTraceValue(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(value, null, 2);
}

function ToolTraceRow(props: { trace: ToolTrace, createdAt: string }) {
  const statusColor = props.trace.status === "completed"
    ? "green"
    : props.trace.status === "failed" || props.trace.status === "interrupted"
      ? "red"
      : "blue";
  return (
    <div className="flex w-full items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border/60" />
      <details
        open={props.trace.status === "running"}
        className="group w-full max-w-2xl rounded-xl bg-foreground/[0.025] px-3 py-2 ring-1 ring-foreground/[0.08]"
      >
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <DesignBadge
                label={props.trace.status}
                color={statusColor}
                size="sm"
                contentMode="text"
              />
              <span className="truncate text-xs font-medium">{props.trace.name}</span>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {props.trace.durationMs != null ? `${props.trace.durationMs} ms · ` : ""}
              {new Date(props.createdAt).toLocaleTimeString()}
            </span>
          </div>
        </summary>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Input
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/[0.03] p-2 text-[11px] whitespace-pre-wrap break-all">
              {formatTraceValue(props.trace.input)}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {props.trace.status === "failed" || props.trace.status === "interrupted" ? "Error" : "Result"}
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/[0.03] p-2 text-[11px] whitespace-pre-wrap break-all">
              {props.trace.status === "failed" || props.trace.status === "interrupted"
                ? props.trace.error ?? "Tool execution failed"
                : props.trace.status === "running"
                  ? "Running…"
                  : formatTraceValue(props.trace.output)}
            </pre>
          </div>
        </div>
      </details>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function BrainMessageBubble(props: { message: BrainMessageDto }) {
  // Tool-trace rows are rendered by ToolTraceRow; never fall back to a bubble.
  if (props.message.role === "tool") return null;
  const isUser = props.message.role === "user";
  const text = messageText(props.message.content);
  if (text.length === 0) return null;
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-2 rounded-2xl px-4 py-3",
          isUser
            ? "bg-foreground text-background"
            : "bg-foreground/[0.04] ring-1 ring-foreground/[0.06]",
        )}
      >
        <div className="text-sm whitespace-pre-wrap break-words">{text}</div>
        <div className={cn(
          "text-[10px]",
          isUser ? "text-background/60" : "text-muted-foreground",
        )}>
          {isUser ? "You" : "Brain"} · {new Date(props.message.created_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function BrainTimelineEntry(props: { message: BrainMessageDto }) {
  const persistedTrace = getPersistedToolTrace(props.message);
  if (persistedTrace != null) {
    return <ToolTraceRow trace={persistedTrace} createdAt={props.message.created_at} />;
  }
  const legacyTraces = getLegacyToolTraces(props.message.content);
  return (
    <>
      <BrainMessageBubble message={props.message} />
      {legacyTraces.map((trace) => (
        <ToolTraceRow key={trace.key} trace={trace} createdAt={props.message.created_at} />
      ))}
    </>
  );
}

function queueStatusColor(status: string): "blue" | "green" | "red" {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  return "blue";
}

function QueueDialog(props: {
  open: boolean,
  onClose: () => void,
  app: unknown,
  pendingCount: number,
  onRetried: () => void,
}) {
  const [items, setItems] = useState<BrainQueueItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFailedIds, setSelectedFailedIds] = useState<Set<string>>(new Set());

  // Load when opened — keyed off `open` via the dialog action rather than a
  // mount effect inside a always-mounted tree. The parent only mounts us when
  // open is true.
  const load = useCallback(async () => {
    setError(null);
    const page = await fetchBrainQueue(props.app, {
      limit: 50,
      status: "QUEUED,CLAIMED,COMPLETED,FAILED",
    });
    setItems(page.items);
  }, [props.app]);

  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;

    const poll = async () => {
      try {
        const page = await fetchBrainQueue(props.app, {
          limit: 50,
          status: "QUEUED,CLAIMED,COMPLETED,FAILED",
        });
        if (!cancelled) {
          setItems(page.items);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load queue");
        }
      } finally {
        if (!cancelled) {
          timerId = window.setTimeout(() => runAsynchronously(poll), 1_000);
        }
      }
    };

    runAsynchronously(poll);
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [props.app]);

  return (
    <DesignDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="2xl"
      title="Brain Queue"
      description={`${props.pendingCount} pending · recent activity refreshes live`}
    >
      <div className="flex flex-col gap-3 max-h-[60vh]">
        <div className="flex justify-end gap-2">
          <DesignButton
            variant="outline"
            size="sm"
            onClick={async () => {
              await load();
            }}
          >
            <ArrowClockwiseIcon className="h-4 w-4" />
            Refresh
          </DesignButton>
          {selectedFailedIds.size > 0 && (
            <DesignButton
              size="sm"
              onClick={async () => {
                await retryBrainQueueItems(props.app, [...selectedFailedIds]);
                setSelectedFailedIds(new Set());
                props.onRetried();
                await load();
              }}
            >
              Retry selected
            </DesignButton>
          )}
        </div>

        {error != null && (
          <DesignAlert variant="error">{error}</DesignAlert>
        )}
        {items == null && error == null && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {items != null && items.length === 0 && (
          <DesignAlert>
            No queue activity yet. New users, sign-ins, emails, and payments will appear here.
          </DesignAlert>
        )}
        {items != null && items.length > 0 && (
          <div className="flex flex-col gap-2 overflow-y-auto">
            {items.map((item) => {
              const isFailed = item.status === "FAILED";
              const selected = selectedFailedIds.has(item.id);
              return (
                <DesignCard key={item.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Typography className="font-medium text-sm truncate">{item.type}</Typography>
                        <DesignBadge
                          color={queueStatusColor(item.status)}
                          contentMode="text"
                          label={item.status}
                          size="sm"
                        />
                      </div>
                      <Typography variant="secondary" className="text-xs mt-1">
                        {new Date(item.occurred_at).toLocaleString()}
                        {item.subject_type != null ? ` · ${item.subject_type}` : ""}
                        {item.subject_id != null ? ` ${item.subject_id}` : ""}
                        {item.attempts > 0 ? ` · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}` : ""}
                      </Typography>
                      {item.last_error != null && (
                        <Typography variant="secondary" className="text-xs mt-1 text-destructive">
                          {item.last_error}
                        </Typography>
                      )}
                      <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-foreground/[0.03] p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    </div>
                    {isFailed && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          setSelectedFailedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        }}
                        aria-label={`Select failed item ${item.id}`}
                      />
                    )}
                  </div>
                </DesignCard>
              );
            })}
          </div>
        )}
      </div>
    </DesignDialog>
  );
}

function BrainChat() {
  const app = useAdminApp();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const stageLabel = getAppStageLabel("brain");

  const applyBrainState = useCallback((data: BrainStateDto) => {
    const messageList = messageListRef.current;
    const shouldFollowLatest = messageList == null
      || messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
    setState({ status: "ok", data });
    setRefreshError(null);
    setLastRefreshedAt(new Date());
    if (shouldFollowLatest) {
      window.requestAnimationFrame(() => {
        messageEndRef.current?.scrollIntoView({ block: "end" });
      });
    }
  }, []);

  const reload = useCallback(async () => {
    const data = await fetchBrainState(app, { limit: 100 });
    applyBrainState(data);
    return data;
  }, [app, applyBrainState]);

  // Brain turns happen asynchronously after API requests return. A short,
  // cancellable poll keeps status, messages, and queue count feeling live
  // without overlapping requests or leaving timers behind after navigation.
  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;

    const poll = async () => {
      try {
        const data = await fetchBrainState(app, { limit: 100 });
        if (cancelled) return;
        applyBrainState(data);
        const latestRole = data.messages.at(-1)?.role;
        const isActive = data.run_state === "RUNNING" || latestRole === "user";
        timerId = window.setTimeout(() => runAsynchronously(poll), isActive ? 350 : 1_500);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Failed to refresh Brain";
          setRefreshError(message);
          setState((current) => current.status === "loading"
            ? { status: "error", message }
            : current);
          timerId = window.setTimeout(() => runAsynchronously(poll), 1_500);
        }
      }
    };

    runAsynchronously(poll);
    return () => {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [app, applyBrainState]);

  const pendingCount = state.status === "ok" ? state.data.pending_queue_count : 0;
  const runState = state.status === "ok" ? state.data.run_state : "NONE";

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-2">
      {stageLabel != null && (
        <DesignBadge label={stageLabel} color="purple" size="sm" />
      )}
      <DesignButton
        variant="outline"
        size="sm"
        onClick={async () => {
          setQueueOpen(true);
        }}
      >
        <ListBulletsIcon className="h-4 w-4" />
        Queue{pendingCount > 0 ? ` (${pendingCount})` : ""}
      </DesignButton>
      <DesignButton
        variant="outline"
        size="sm"
        onClick={async () => {
          await reload();
        }}
      >
        <ArrowClockwiseIcon className="h-4 w-4" />
        Refresh
      </DesignButton>
    </div>
  ), [pendingCount, reload, stageLabel]);

  return (
    <PageLayout
      title="Brain"
      description="One persistent AI that manages this environment and works down the Brain Queue"
      actions={headerActions}
      fillWidth
      containedHeight
    >
      {state.status === "loading" && (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-20 w-2/3" />
          <Skeleton className="h-20 w-1/2 self-end" />
          <Skeleton className="h-20 w-3/5" />
        </div>
      )}
      {state.status === "error" && (
        <DesignAlert variant="error" className="m-4">
          {state.message}
        </DesignAlert>
      )}
      {state.status === "ok" && (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
            <SparkleIcon className={cn("h-3.5 w-3.5", runState === "RUNNING" && "animate-pulse")} />
            <span>
              {runState === "RUNNING" ? "Brain is working…" : "Brain is idle"}
              {pendingCount > 0 ? ` · ${pendingCount} queued` : ""}
              {lastRefreshedAt != null ? ` · Live as of ${lastRefreshedAt.toLocaleTimeString()}` : ""}
            </span>
          </div>
          {refreshError != null && (
            <DesignAlert variant="error" className="mx-4 mb-2">
              Live refresh failed: {refreshError}
            </DesignAlert>
          )}
          <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {state.data.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <SparkleIcon className="h-10 w-10 text-muted-foreground" />
                <Typography className="font-medium">Your Brain is ready</Typography>
                <Typography variant="secondary" className="max-w-md text-sm">
                  Chat here anytime. While the queue has items, Brain stays awake and processes them on its own.
                </Typography>
              </div>
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-3">
                {state.data.messages.map((message) => (
                  <BrainTimelineEntry key={message.id} message={message} />
                ))}
                <div ref={messageEndRef} />
              </div>
            )}
          </div>
          <div className="border-t border-border/60 p-4">
            <div className="mx-auto flex max-w-3xl gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Message the Brain…"
                className="flex-1"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const text = draft.trim();
                    if (text.length === 0) return;
                    runAsynchronouslyWithAlert(async () => {
                      setDraft("");
                      await postBrainMessage(app, text);
                      await reload();
                    });
                  }
                }}
              />
              <DesignButton
                disabled={draft.trim().length === 0}
                onClick={async () => {
                  const text = draft.trim();
                  if (text.length === 0) return;
                  setDraft("");
                  await postBrainMessage(app, text);
                  await reload();
                }}
              >
                <PaperPlaneTiltIcon className="h-4 w-4" />
                Send
              </DesignButton>
            </div>
          </div>
        </div>
      )}

      {queueOpen && (
        <QueueDialog
          open={queueOpen}
          onClose={() => setQueueOpen(false)}
          app={app}
          pendingCount={pendingCount}
          onRetried={() => {
            runAsynchronouslyWithAlert(reload);
          }}
        />
      )}
    </PageLayout>
  );
}

export default function PageClient() {
  return (
    <AppEnabledGuard appId="brain">
      <BrainChat />
    </AppEnabledGuard>
  );
}
