import { useUser } from "@hexclave/next";
import { useCallback, useEffect, useState } from "react";
import { AddManualQa } from "../components/AddManualQa";
import { Analytics } from "../components/Analytics";
import { CallLogDetail } from "../components/CallLogDetail";
import { CallLogList } from "../components/CallLogList";
import { FeedbackDetail } from "../components/FeedbackDetail";
import { FeedbackList } from "../components/FeedbackList";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { ThemeToggle } from "../components/ThemeToggle";
import { Usage } from "../components/Usage";
import { UsageDetail } from "../components/UsageDetail";
import { Button, cn } from "../components/design";
import { type GetSpacetimeToken, useAiQueryLogs, useFeedbackLog, useMcpCallLogs, useQaEntries } from "../hooks/useSpacetimeDB";
import { retryReview } from "../lib/mcp-review-api";
import type { AiQueryLogRow, FeedbackLogRow, McpCallLogRow } from "../types";

type Tab = "calls" | "knowledge" | "usage" | "feedback";
const TAB_STORAGE_KEY = "internal-tool-active-tab";
const TABS: ReadonlyArray<{ id: Tab, label: string }> = [
  { id: "calls", label: "MCP Review" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "usage", label: "Unified AI Endpoint Analytics" },
  { id: "feedback", label: "Feedback" },
];
const VALID_TABS: readonly Tab[] = TABS.map(t => t.id);

/** Detail drawer on the right of the split views. */
const asideClasses = "w-[480px] shrink-0 overflow-y-auto border-l border-black/[0.06] bg-card backdrop-blur-xl dark:border-white/[0.06]";

function readInitialTab(): Tab {
  // sessionStorage is per-tab: reload preserves the active tab, but a brand-new
  // browser tab gets the default ("calls").
  if (typeof window === "undefined") return "calls";
  const saved = window.sessionStorage.getItem(TAB_STORAGE_KEY);
  if (saved != null && (VALID_TABS as readonly string[]).includes(saved)) {
    return saved as Tab;
  }
  return "calls";
}

export default function App() {
  const user = useUser({ or: "redirect" });
  const [selectedRow, setSelectedRow] = useState<McpCallLogRow | null>(null);
  const [selectedUsageRow, setSelectedUsageRow] = useState<AiQueryLogRow | null>(null);
  const [selectedFeedbackRow, setSelectedFeedbackRow] = useState<FeedbackLogRow | null>(null);
  const [showAddQa, setShowAddQa] = useState(false);
  const [tab, setTab] = useState<Tab>(readInitialTab);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

  // Any signed-in user may use the tool: membership in the Stack Auth project
  // is the authorization (its sign-up rules restrict membership to the team).
  // The server verifies the cookie session and mints a short-lived
  // SpacetimeDB JWT under the tool's own OIDC issuer — Stack Auth session
  // tokens themselves aren't OIDC-discoverable by SpacetimeDB.
  const getSpacetimeToken = useCallback<GetSpacetimeToken>(async () => {
    const res = await fetch("/api/spacetimedb-token", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new Error(`SpacetimeDB token mint failed (${res.status}): ${await res.text()}`);
    }
    const { token } = await res.json() as { token?: string };
    if (typeof token !== "string" || token === "") throw new Error("SpacetimeDB token mint returned no token");
    return token;
  }, []);

  const { rows, connectionState, connectionErrorMessage, callReducer: callMcpReducer } = useMcpCallLogs(getSpacetimeToken);
  const {
    rows: usageRows,
    connectionState: usageConnectionState,
    connectionErrorMessage: usageConnectionErrorMessage,
  } = useAiQueryLogs(getSpacetimeToken);
  const {
    rows: qaRows,
    connectionState: qaConnectionState,
    connectionErrorMessage: qaConnectionErrorMessage,
    callReducer: callQaReducer,
  } = useQaEntries(getSpacetimeToken);

  const {
    rows: feedbackRows,
    connectionState: feedbackConnectionState,
    connectionErrorMessage: feedbackConnectionErrorMessage,
  } = useFeedbackLog(getSpacetimeToken);

  const currentSelectedRow = selectedRow
    ? rows.find(r => r.id === selectedRow.id) ?? selectedRow
    : null;

  const currentSelectedFeedbackRow = selectedFeedbackRow
    ? feedbackRows.find(r => r.id === selectedFeedbackRow.id) ?? selectedFeedbackRow
    : null;

  const relatedCallForFeedback = currentSelectedFeedbackRow?.conversationId == null
    ? null
    : rows.find(r => r.conversationId === currentSelectedFeedbackRow.conversationId) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="grid shrink-0 grid-cols-3 items-center gap-3 border-b border-black/[0.06] bg-card px-6 py-3 backdrop-blur-xl dark:border-white/[0.06]">
        <div className="flex items-center justify-start">
          <h1 className="text-base font-semibold tracking-tight text-foreground">MCP Review Tool</h1>
        </div>
        {/* Tabs — centered */}
        <div className="flex justify-center">
          <div className="flex gap-0.5 rounded-full border border-black/[0.06] bg-foreground/[0.04] p-0.5 ring-1 ring-black/[0.03] dark:border-white/[0.06] dark:ring-white/[0.03]">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setSelectedRow(null);
                }}
                aria-pressed={tab === id}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  "transition-colors hover:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  tab === id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {tab === "knowledge" && (
            <Button variant="default" onClick={() => setShowAddQa(true)}>
              + Add Q&A
            </Button>
          )}
          <span className="max-w-[180px] truncate text-xs text-muted-foreground">{user.displayName ?? user.primaryEmail}</span>
          <ThemeToggle />
        </div>
      </header>

      {showAddQa && (
        <AddManualQa
          onClose={() => setShowAddQa(false)}
          onSave={async (question, answer, publish, requestId) => {
            await callQaReducer(conn => conn.reducers.addManualQa({
              question,
              answer,
              publish,
              requestId,
            }));
          }}
        />
      )}

      <div className="flex-1 overflow-hidden flex">
        {tab === "calls" && (
          <>
            <main className="flex-1 overflow-y-auto p-6 space-y-6">
              <Analytics rows={rows} qaEntries={qaRows} />
              <CallLogList
                rows={rows}
                connectionState={connectionState}
                connectionErrorMessage={connectionErrorMessage}
                onSelect={setSelectedRow}
                selectedId={selectedRow?.id}
              />
            </main>
            {currentSelectedRow && (
              <aside className={asideClasses}>
                <CallLogDetail
                  key={String(currentSelectedRow.id)}
                  row={currentSelectedRow}
                  allRows={rows}
                  qaEntries={qaRows}
                  onClose={() => setSelectedRow(null)}
                  onSaveCorrection={(correlationId, correctedQuestion, correctedAnswer, publish) =>
                    callMcpReducer(conn => conn.reducers.upsertQaFromCallAndMarkReviewed({
                      correlationId,
                      question: correctedQuestion,
                      answer: correctedAnswer,
                      publish,
                    }))
                  }
                  onSetReviewed={(correlationId, reviewed) =>
                    callMcpReducer(conn => conn.reducers.setHumanReviewed({
                      correlationId,
                      reviewed,
                    }))
                  }
                  onRetryReview={(correlationId, payload) =>
                    retryReview({ correlationId, ...payload })
                  }
                />
              </aside>
            )}
          </>
        )}

        {tab === "knowledge" && (
          <main className="flex-1 overflow-y-auto">
            <div className="p-6 max-w-4xl mx-auto">
              <KnowledgeBase
                rows={qaRows}
                connectionState={qaConnectionState}
                connectionErrorMessage={qaConnectionErrorMessage}
                onSave={(qaId, question, answer, publish) =>
                  callQaReducer(conn => conn.reducers.updateQaEntryWithPublish({
                    qaId,
                    question,
                    answer,
                    publish,
                  }))
                }
                onDelete={(qaId) =>
                  callQaReducer(conn => conn.reducers.deleteQaEntry({ qaId }))
                }
              />
            </div>
          </main>
        )}

        {tab === "usage" && (
          <>
            <main className="flex-1 overflow-y-auto">
              <div className="p-6 max-w-6xl mx-auto">
                <Usage
                  rows={usageRows}
                  connectionState={usageConnectionState}
                  connectionErrorMessage={usageConnectionErrorMessage}
                  onSelect={setSelectedUsageRow}
                  selectedId={selectedUsageRow?.id}
                />
              </div>
            </main>
            {selectedUsageRow && (
              <aside className={asideClasses}>
                <UsageDetail
                  row={usageRows.find(r => r.id === selectedUsageRow.id) ?? selectedUsageRow}
                  onClose={() => setSelectedUsageRow(null)}
                />
              </aside>
            )}
          </>
        )}

        {tab === "feedback" && (
          <>
            <main className="flex-1 overflow-y-auto">
              <div className="p-6 max-w-4xl mx-auto">
                <FeedbackList
                  rows={feedbackRows}
                  connectionState={feedbackConnectionState}
                  connectionErrorMessage={feedbackConnectionErrorMessage}
                  onSelect={setSelectedFeedbackRow}
                  selectedId={currentSelectedFeedbackRow?.id}
                />
              </div>
            </main>
            {currentSelectedFeedbackRow && (
              <aside className={asideClasses}>
                <FeedbackDetail
                  key={String(currentSelectedFeedbackRow.id)}
                  row={currentSelectedFeedbackRow}
                  relatedCall={relatedCallForFeedback}
                  onClose={() => setSelectedFeedbackRow(null)}
                  onOpenRelatedCall={(call) => {
                    setSelectedRow(call);
                    setTab("calls");
                  }}
                />
              </aside>
            )}
          </>
        )}
      </div>
    </div>
  );
}
