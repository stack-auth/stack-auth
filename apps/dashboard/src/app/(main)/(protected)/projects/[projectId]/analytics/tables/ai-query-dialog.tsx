"use client";

import { Button } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CopyIcon,
  FloppyDiskIcon,
  LayoutIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  SpinnerGapIcon,
  StopIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import {
  runAsynchronously,
  runAsynchronouslyWithAlert,
} from "@stackframe/stack-shared/dist/utils/promises";
import type { UIMessage } from "@ai-sdk/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CmdKPreviewProps } from "@/components/cmdk-commands";
import { CreateDashboardPreview } from "@/components/commands/create-dashboard/create-dashboard-preview";
import { useAdminApp } from "../../use-admin-app";
import type { AiQueryChat } from "./use-ai-query-chat";

// ─── Chat message rendering ─────────────────────────────────────────

type OrderedPart =
  | { kind: "text", text: string }
  | { kind: "tool", id: string, state: string, query: string | null, error: string | null };

function getOrderedParts(message: UIMessage): OrderedPart[] {
  const parts: OrderedPart[] = [];
  for (const [idx, part] of message.parts.entries()) {
    if (part.type === "text") {
      const text = (part as { type: "text", text: string }).text;
      if (text.trim()) {
        parts.push({ kind: "text", text });
      }
      continue;
    }
    if (!part.type.startsWith("tool-") || !part.type.endsWith("queryAnalytics")) continue;
    const tp = part as {
      type: string,
      state: string,
      input?: Record<string, unknown>,
      output?: Record<string, unknown>,
    };
    const query =
      typeof tp.input?.query === "string" ? (tp.input.query as string) : null;
    const output = tp.output;
    let errorMessage: string | null = null;
    if (output && typeof output === "object") {
      const success = (output as { success?: unknown }).success;
      if (success === false) {
        const err = (output as { error?: unknown }).error;
        errorMessage = typeof err === "string" ? err : "Query failed";
      }
    }
    parts.push({
      kind: "tool",
      id: `${message.id}-${idx}`,
      state: tp.state,
      query,
      error: errorMessage,
    });
  }
  return parts;
}

const UserMessageBubble = memo(function UserMessageBubble({
  content,
}: {
  content: string,
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-muted/50 flex items-center justify-center">
        <UserIcon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 text-sm text-foreground whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
});

const AssistantMessageBubble = memo(function AssistantMessageBubble({
  parts,
  currentQuery,
  onRewindToQuery,
}: {
  parts: OrderedPart[],
  currentQuery: string | null,
  onRewindToQuery: (query: string) => void,
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center">
        <SparkleIcon className="h-3 w-3 text-purple-400" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {parts.map((part, idx) => {
          if (part.kind === "text") {
            return (
              <div key={idx} className="prose prose-sm prose-invert max-w-none text-sm text-foreground/90 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }
          const isActiveQuery = part.query != null && part.query === currentQuery;
          return (
            <div
              key={part.id}
              className={cn(
                "rounded-md border px-2 py-1.5 text-[11px]",
                part.error
                  ? "border-red-500/30 bg-red-500/5 text-red-300"
                  : part.state === "output-available"
                    ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                    : "border-purple-500/20 bg-purple-500/5 text-purple-200",
              )}
            >
              <div className="flex items-center gap-1.5">
                {part.state !== "output-available" && !part.error && (
                  <SpinnerGapIcon className="h-3 w-3 animate-spin" />
                )}
                <span className="font-medium">
                  {part.error
                    ? "Query failed"
                    : part.state === "output-available"
                      ? "Ran query"
                      : "Building query"}
                </span>
                {!isActiveQuery && part.query && part.state === "output-available" && !part.error && (
                  <>
                    <div className="flex-1" />
                    <SimpleTooltip tooltip="Rewind to this query">
                      <button
                        type="button"
                        onClick={() => onRewindToQuery(part.query!)}
                        className="p-0.5 rounded text-current opacity-60 hover:opacity-100 transition-opacity hover:transition-none"
                        aria-label="Rewind to this query"
                      >
                        <ArrowCounterClockwiseIcon className="h-3 w-3" />
                      </button>
                    </SimpleTooltip>
                  </>
                )}
              </div>
              {part.error && (
                <p className="mt-1 font-mono text-[10px] opacity-90">
                  {part.error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─── Save query sub-dialog ──────────────────────────────────────────

function SaveQueryInlineDialog({
  open,
  onOpenChange,
  sqlQuery,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  sqlQuery: string,
}) {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setDisplayName("");
      setSaving(false);
    }
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!displayName.trim() || !sqlQuery.trim()) return;
    setSaving(true);
    try {
      // Reuse an existing folder if available, otherwise create an
      // "AI Queries" bucket on the fly so the save flow never stalls
      // on folder management.
      const existingFolders = Object.entries(config.analytics.queryFolders);
      let folderId: string;
      if (existingFolders.length > 0) {
        folderId = existingFolders[0]![0];
      } else {
        folderId = generateSecureRandomString();
        await updateConfig({
          adminApp,
          configUpdate: {
            [`analytics.queryFolders.${folderId}`]: {
              displayName: "AI Queries",
              sortOrder: 0,
              queries: {},
            },
          },
          pushable: false,
        });
      }

      const queryId = generateSecureRandomString();
      await updateConfig({
        adminApp,
        configUpdate: {
          [`analytics.queryFolders.${folderId}.queries.${queryId}`]: {
            displayName: displayName.trim(),
            sqlQuery,
          },
        },
        pushable: false,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [displayName, sqlQuery, config, updateConfig, adminApp, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save query</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-save-query-name">Name</Label>
              <Input
                id="ai-save-query-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Recent signups"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    runAsynchronouslyWithAlert(handleSave);
                  }
                }}
              />
            </div>
            <div className="rounded-md border border-border/50 bg-muted/30 p-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground max-h-32 overflow-auto">
                {sqlQuery}
              </pre>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => runAsynchronouslyWithAlert(handleSave)}
            disabled={!displayName.trim() || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Build dashboard sub-dialog ─────────────────────────────────────

/**
 * Reuses the existing `CreateDashboardPreview` component (the same
 * one the Cmd+K command center uses) so the dashboard-builder
 * experience is identical whether you enter it from the command
 * palette or from the analytics AI query builder. Most of
 * `CmdKPreviewProps` are unused by `CreateDashboardPreview` internally,
 * so we pass no-op stubs for them.
 */
function BuildDashboardDialog({
  open,
  onOpenChange,
  sqlQuery,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  sqlQuery: string,
}) {
  // Synthesize a prompt that pre-seeds the SQL query as context so
  // the dashboard the AI generates visualizes exactly these results.
  const dashboardPrompt = useMemo(
    () =>
      `Build a dashboard that visualizes the results of this ClickHouse query:\n\n\`\`\`sql\n${sqlQuery}\n\`\`\``,
    [sqlQuery],
  );

  const stubProps: Omit<CmdKPreviewProps, "query" | "onClose"> = {
    isSelected: true,
    registerOnFocus: () => {
      // no-op
    },
    unregisterOnFocus: () => {
      // no-op
    },
    onBlur: () => {
      // no-op
    },
    registerNestedCommands: () => {
      // no-op
    },
    navigateToNested: () => {
      // no-op
    },
    depth: 0,
    pathname: "",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[80vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <LayoutIcon className="h-4 w-4 text-cyan-500" />
            Build dashboard
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {open && (
            <CreateDashboardPreview
              query={dashboardPrompt}
              onClose={() => onOpenChange(false)}
              {...stubProps}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main dialog ────────────────────────────────────────────────────

type AiQueryDialogProps = {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  chat: AiQueryChat,
  /** The query currently driving the data grid (may be `null` if none yet). */
  currentQuery: string | null,
};

export function AiQueryDialog({
  open,
  onOpenChange,
  chat,
  currentQuery,
}: AiQueryDialogProps) {
  const [followUpInput, setFollowUpInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the bottom whenever a new message arrives.
  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTop =
      messagesContainerRef.current.scrollHeight;
  }, [chat.messages, chat.isResponding]);

  // Focus the input when the dialog opens so the user can keep typing.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSend = useCallback(() => {
    const text = followUpInput.trim();
    if (!text || chat.isResponding) return;
    setFollowUpInput("");
    runAsynchronously(chat.sendMessage({ text }));
  }, [followUpInput, chat]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleCopy = useCallback(async () => {
    if (!currentQuery) return;
    await navigator.clipboard.writeText(currentQuery);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [currentQuery]);

  const canActOnQuery = Boolean(currentQuery && currentQuery.trim().length > 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent noCloseButton className="max-w-3xl h-[80vh] p-0 overflow-hidden flex flex-col gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <SparkleIcon className="h-4 w-4 text-purple-400" />
                AI query builder
              </DialogTitle>
              <div className="flex items-center gap-1">
                {chat.messages.length > 0 && (
                  <SimpleTooltip tooltip="Clear chat">
                    <button
                      type="button"
                      onClick={() => chat.setMessages([])}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors hover:transition-none"
                      aria-label="Clear chat"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </SimpleTooltip>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors hover:transition-none"
                  aria-label="Close"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </DialogHeader>

          {/* Current query */}
          <div className="shrink-0 border-b border-border/40 bg-muted/20">
            <div className="flex items-center justify-between px-5 py-2">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Current query
              </Label>
              {canActOnQuery && (
                <SimpleTooltip tooltip={copied ? "Copied!" : "Copy SQL"}>
                  <button
                    type="button"
                    onClick={() => runAsynchronously(handleCopy())}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors hover:transition-none"
                  >
                    {copied ? (
                      <CheckIcon className="h-3 w-3 text-green-400" />
                    ) : (
                      <CopyIcon className="h-3 w-3" />
                    )}
                  </button>
                </SimpleTooltip>
              )}
            </div>
            <pre className="px-5 pb-3 whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/90 max-h-32 overflow-auto">
              {currentQuery?.trim() || (
                <span className="text-muted-foreground italic">
                  Ask the AI a question to generate a query.
                </span>
              )}
            </pre>
          </div>

          {/* Chat thread */}
          <div
            ref={messagesContainerRef}
            className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4"
          >
            {chat.messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                  <SparkleIcon className="h-4 w-4 text-purple-400" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Describe what you want to see.
                </p>
                <p className="text-[11px] text-muted-foreground/70 max-w-sm">
                  Try: &ldquo;daily signups over the last 30 days&rdquo; or
                  &ldquo;top 10 users by event count this week&rdquo;.
                </p>
              </div>
            )}

            {chat.messages.map((message) => {
              if (message.role === "user") {
                const text = message.parts
                  .filter((p): p is { type: "text", text: string } => p.type === "text")
                  .map((p) => p.text)
                  .join("");
                return (
                  <UserMessageBubble key={message.id} content={text} />
                );
              }
              const parts = getOrderedParts(message);
              if (parts.length === 0) return null;
              return (
                <AssistantMessageBubble
                  key={message.id}
                  parts={parts}
                  currentQuery={currentQuery}
                  onRewindToQuery={chat.rewindToQuery}
                />
              );
            })}

            {chat.isResponding && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <SpinnerGapIcon className="h-3 w-3 animate-spin text-purple-400" />
                Thinking…
              </div>
            )}

            {chat.error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
                {chat.error.message || "Failed to get a response."}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border/40 px-5 py-3">
            <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-1.5 ring-1 ring-foreground/[0.08] focus-within:ring-purple-500/30 transition-shadow">
              <input
                ref={inputRef}
                type="text"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Refine the query…"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                disabled={chat.isResponding}
              />
              {chat.isResponding ? (
                <SimpleTooltip tooltip="Stop generating">
                  <button
                    type="button"
                    onClick={() => void chat.stop()}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors hover:transition-none"
                    aria-label="Stop generating"
                  >
                    <StopIcon weight="fill" className="h-3.5 w-3.5" />
                  </button>
                </SimpleTooltip>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!followUpInput.trim()}
                  className={cn(
                    "shrink-0 rounded p-0.5 text-muted-foreground",
                    "hover:text-purple-400 disabled:opacity-40 disabled:hover:text-muted-foreground",
                    "transition-colors hover:transition-none",
                  )}
                  aria-label="Send"
                >
                  <PaperPlaneTiltIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Actions */}
          <DialogFooter className="px-5 py-3 border-t border-border/40 sm:justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Save the query or turn it into a live dashboard.
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!canActOnQuery}
                onClick={() => setSaveOpen(true)}
                className="gap-1.5"
              >
                <FloppyDiskIcon className="h-3.5 w-3.5" />
                Save query
              </Button>
              <Button
                size="sm"
                disabled={!canActOnQuery}
                onClick={() => setBuildOpen(true)}
                className="gap-1.5"
              >
                <LayoutIcon className="h-3.5 w-3.5" />
                Build dashboard
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SaveQueryInlineDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        sqlQuery={currentQuery ?? ""}
      />
      <BuildDashboardDialog
        open={buildOpen}
        onOpenChange={setBuildOpen}
        sqlQuery={currentQuery ?? ""}
      />
    </>
  );
}
