import { useUser } from "@hexclave/next";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { useCallback, useEffect, useState } from "react";
import { AddManualQa } from "../components/AddManualQa";
import { Analytics } from "../components/Analytics";
import { AppSidebar } from "../components/AppSidebar";
import { CallLogDetail } from "../components/CallLogDetail";
import { CallLogList } from "../components/CallLogList";
import { FeedbackDetail } from "../components/FeedbackDetail";
import { FeedbackList } from "../components/FeedbackList";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { Usage } from "../components/Usage";
import { UsageDetail } from "../components/UsageDetail";
import { Button } from "../components/design";
import { ViewHeader } from "../components/design/observability";
import { AnimatedSidebarInset, AnimatedSidebarProvider } from "../components/motion/animated-sidebar";
import { type GetSpacetimeToken, useAiQueryLogs, useFeedbackLog, useMcpCallLogs, useQaEntries } from "../hooks/useSpacetimeDB";
import { retryReview } from "../lib/mcp-review-api";
import type { AiQueryLogRow, FeedbackLogRow, McpCallLogRow } from "../types";

type Tab = "calls" | "knowledge" | "usage" | "feedback";
const TAB_STORAGE_KEY = "internal-tool-active-tab";
const TABS: ReadonlyArray<{ id: Tab, label: string, subtitle: string }> = [
  { id: "calls", label: "MCP Review", subtitle: "QA-scored MCP tool calls" },
  { id: "knowledge", label: "Knowledge Base", subtitle: "Curated question/answer pairs" },
  { id: "usage", label: "Unified AI Endpoint Analytics", subtitle: "Requests across the AI endpoint" },
  { id: "feedback", label: "Feedback", subtitle: "Ratings left on answers" },
];
const VALID_TABS: readonly Tab[] = TABS.map(t => t.id);

/** Detail drawer on the right of the split views. */
const asideClasses = "w-[480px] shrink-0 overflow-y-auto border-l border-border bg-surface";

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

  const activeTab = TABS.find(t => t.id === tab)
    ?? throwErr(`No tab metadata for ${tab}; TABS must cover every Tab`);

  const connectionForTab = new Map<Tab, typeof connectionState>([
    ["calls", connectionState],
    ["knowledge", qaConnectionState],
    ["usage", usageConnectionState],
    ["feedback", feedbackConnectionState],
  ]);

  return (
    <AnimatedSidebarProvider className="h-dvh min-h-0 overflow-hidden bg-sidebar">
      <AppSidebar
        onSelectView={(next) => {
          setTab(next);
          setSelectedRow(null);
        }}
        userLabel={user.displayName ?? user.primaryEmail ?? "Signed in"}
        view={tab}
      />

      <AnimatedSidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-2xl">
        <ViewHeader
          connection={connectionForTab.get(tab) ?? throwErr(`No connection state for tab ${tab}; connectionForTab must cover every Tab`)}
          subtitle={activeTab.subtitle}
          title={activeTab.label}
          toolbar={tab === "knowledge"
            ? (
              <Button variant="default" onClick={() => setShowAddQa(true)}>
                  Add Q&A
              </Button>
            )
            : undefined}
        />

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

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {tab === "calls" && (
            <>
              <main className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
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
            <main className="flex-1 overflow-y-auto px-3 pb-3">
              <div className="mx-auto max-w-4xl">
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
              <main className="flex-1 overflow-y-auto px-3 pb-3">
                <div className="mx-auto max-w-6xl">
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
              <main className="flex-1 overflow-y-auto px-3 pb-3">
                <div className="mx-auto max-w-4xl">
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
      </AnimatedSidebarInset>
    </AnimatedSidebarProvider>
  );
}
