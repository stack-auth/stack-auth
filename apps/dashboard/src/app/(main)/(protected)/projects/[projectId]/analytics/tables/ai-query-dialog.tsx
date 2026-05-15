"use client";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import type { CmdKPreviewProps } from "@/components/cmdk-commands";
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
import { Textarea } from "@/components/ui/textarea";
import { CreateDashboardPreview } from "@/components/commands/create-dashboard/create-dashboard-preview";
import { useUpdateConfig } from "@/lib/config-update";
import { AssistantRuntimeProvider, type ToolCallContentPartProps } from "@assistant-ui/react";
import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  FloppyDiskIcon,
  LayoutIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import {
  runAsynchronously,
  runAsynchronouslyWithAlert,
} from "@stackframe/stack-shared/dist/utils/promises";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAdminApp } from "../../use-admin-app";
import type { AiQueryChat } from "./use-ai-query-chat";

function AnalyticsQueryToolCall(
  props: ToolCallContentPartProps & {
    currentQuery: string | null,
    onApplyQuery: (query: string) => void,
  },
) {
  const query = (props.args as { query?: unknown } | undefined)?.query;
  const queryString = typeof query === "string" ? query : "";
  const result = props.result as { success?: unknown } | null | undefined;
  const isSuccessful = props.status.type === "complete" && result?.success !== false;
  const canApply = isSuccessful && queryString.trim().length > 0 && queryString !== props.currentQuery;

  return (
    <ToolFallback
      {...props}
      headerAction={canApply ? (
        <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <SimpleTooltip tooltip="Use this query">
            <button
              type="button"
              onClick={() => props.onApplyQuery(queryString)}
              className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium leading-none text-muted-foreground/70 transition-colors hover:transition-none hover:bg-foreground/[0.06] hover:text-foreground"
              aria-label="Use this query"
            >
              <ArrowClockwiseIcon className="h-2.5 w-2.5" />
              Use query
            </button>
          </SimpleTooltip>
        </span>
      ) : undefined}
    />
  );
}

function AiQueryWelcome() {
  return (
    <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="flex w-full flex-grow flex-col items-center justify-center py-16 px-6">
        <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4 ring-1 ring-purple-500/20">
          <SparkleIcon className="w-6 h-6 text-purple-400" weight="duotone" />
        </div>
        <h2 className="text-base font-semibold tracking-tight text-foreground mb-1.5">
          Build an analytics query
        </h2>
        <p className="text-xs text-muted-foreground text-center max-w-[300px] leading-relaxed">
          Ask for a table, segment, trend, or funnel. Try &ldquo;daily signups over the last 30 days&rdquo; or &ldquo;top 10 users by event count this week&rdquo;.
        </p>
      </div>
    </div>
  );
}

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
  const [copied, setCopied] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [currentQueryDraft, setCurrentQueryDraft] = useState(currentQuery ?? "");
  const assistantContentComponents = useMemo(() => ({
    Text: MarkdownText,
    tools: {
      Fallback: ToolFallback,
      by_name: {
        queryAnalytics: (props: ToolCallContentPartProps) => (
          <AnalyticsQueryToolCall
            {...props}
            currentQuery={currentQuery}
            onApplyQuery={chat.rewindToQuery}
          />
        ),
      },
    },
  }), [chat.rewindToQuery, currentQuery]);

  useEffect(() => {
    setCurrentQueryDraft(currentQuery ?? "");
  }, [currentQuery]);

  const applyCurrentQueryDraft = useCallback(() => {
    if (currentQueryDraft.trim().length === 0 || currentQueryDraft === currentQuery) return;
    chat.rewindToQuery(currentQueryDraft);
  }, [chat, currentQuery, currentQueryDraft]);

  const handleCopy = useCallback(async () => {
    if (!currentQueryDraft) return;
    await navigator.clipboard.writeText(currentQueryDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [currentQueryDraft]);

  const canActOnQuery = currentQueryDraft.trim().length > 0;
  const hasUnappliedCurrentQueryEdits = currentQueryDraft.trim().length > 0 && currentQueryDraft !== (currentQuery ?? "");

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
                      onClick={chat.clearMessages}
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

          <div className="shrink-0 border-b border-border/40 bg-muted/20">
            <div className="flex items-center justify-between px-5 py-2">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Current query
              </Label>
              <div className="flex items-center gap-1">
                {hasUnappliedCurrentQueryEdits && (
                  <SimpleTooltip tooltip="Apply query">
                    <button
                      type="button"
                      onClick={applyCurrentQueryDraft}
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors hover:transition-none"
                    >
                      <ArrowClockwiseIcon className="h-3 w-3" />
                    </button>
                  </SimpleTooltip>
                )}
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
            </div>
            <div className="px-5 pb-3">
              <Textarea
                value={currentQueryDraft}
                onChange={(e) => setCurrentQueryDraft(e.target.value)}
                onBlur={applyCurrentQueryDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    applyCurrentQueryDraft();
                  }
                }}
                placeholder="Ask the AI a question to generate a query."
                className="min-h-16 max-h-32 resize-y overflow-auto border-border/40 bg-background/70 font-mono text-[11px] text-foreground/90 shadow-none placeholder:italic placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {chat.error && (
            <div className="mx-5 mt-3 shrink-0 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-red-300">
              {chat.error.message || "Failed to get a response."}
            </div>
          )}

          <div className="flex flex-1 min-h-0 flex-col">
            <AssistantRuntimeProvider runtime={chat.runtime}>
              <Thread
                composerPlaceholder="Refine the query..."
                runningStatusMessages={["Thinking..."]}
                assistantContentComponents={assistantContentComponents}
                welcome={<AiQueryWelcome />}
              />
            </AssistantRuntimeProvider>
          </div>

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
        sqlQuery={currentQueryDraft}
      />
      <BuildDashboardDialog
        open={buildOpen}
        onOpenChange={setBuildOpen}
        sqlQuery={currentQueryDraft}
      />
    </>
  );
}
