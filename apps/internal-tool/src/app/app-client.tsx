import { useUser } from "@stackframe/stack";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Identity } from "spacetimedb";
import { AddManualQa } from "../components/AddManualQa";
import { Analytics } from "../components/Analytics";
import { CallLogDetail } from "../components/CallLogDetail";
import { CallLogList } from "../components/CallLogList";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { Usage } from "../components/Usage";
import { UsageDetail } from "../components/UsageDetail";
import { useAiQueryLogs, useMcpCallLogs } from "../hooks/useSpacetimeDB";
import { enrollSpacetimeReviewer, makeMcpReviewApi } from "../lib/mcp-review-api";
import type { AiQueryLogRow, McpCallLogRow } from "../types";

type Tab = "calls" | "knowledge" | "usage";
const TAB_STORAGE_KEY = "internal-tool-active-tab";
const VALID_TABS: readonly Tab[] = ["calls", "knowledge", "usage"];

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
  const user = useUser({ or: process.env.NODE_ENV === "development" ? "redirect" : "return-null" });
  const [selectedRow, setSelectedRow] = useState<McpCallLogRow | null>(null);
  const [selectedUsageRow, setSelectedUsageRow] = useState<AiQueryLogRow | null>(null);
  const [showAddQa, setShowAddQa] = useState(false);
  const [tab, setTab] = useState<Tab>(readInitialTab);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);
  const enrolledRef = useRef<Map<string, Promise<void>>>(new Map());
  const ensureEnrolled = useCallback(async (identity: Identity) => {
    if (!user) throw new Error("Not authenticated");
    const key = identity.toHexString();
    const existing = enrolledRef.current.get(key);
    if (existing) return await existing;
    const promise = (async () => {
      const { accessToken, refreshToken } = await user.getAuthJson();
      const authHeaders: Record<string, string> = {};
      if (accessToken) authHeaders["x-stack-access-token"] = accessToken;
      if (refreshToken) authHeaders["x-stack-refresh-token"] = refreshToken;
      try {
        await enrollSpacetimeReviewer({ identity: key }, authHeaders);
      } catch (err) {
        enrolledRef.current.delete(key);
        throw err;
      }
    })();
    enrolledRef.current.set(key, promise);
    return await promise;
  }, [user]);
  const memoizedEnsureEnrolled = useMemo(() => user ? ensureEnrolled : undefined, [user, ensureEnrolled]);

  const { rows, connectionState } = useMcpCallLogs(memoizedEnsureEnrolled);
  const { rows: usageRows, connectionState: usageConnectionState } = useAiQueryLogs(memoizedEnsureEnrolled);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">MCP Review Tool</h1>
          <p className="text-sm text-gray-500 mb-4">
            Sign in to the{" "}
            <a href={process.env.NEXT_PUBLIC_STACK_DASHBOARD_URL} className="text-blue-600 underline" target="_blank" rel="noreferrer">
              Stack Dashboard
            </a>
            {" "}first, then reload this page.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  const metadata = user.clientReadOnlyMetadata as Record<string, unknown> | null;
  if (!metadata?.isAiChatReviewer) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-sm text-gray-500 mb-1">
            You are signed in as {user.displayName ?? user.primaryEmail}, but your account is not approved.
          </p>
        </div>
      </div>
    );
  }

  const currentSelectedRow = selectedRow
    ? rows.find(r => r.id === selectedRow.id) ?? selectedRow
    : null;

  const currentUser = user;

  async function getApi() {
    const { accessToken, refreshToken } = await currentUser.getAuthJson();
    const authHeaders: Record<string, string> = {};
    if (accessToken) authHeaders["x-stack-access-token"] = accessToken;
    if (refreshToken) authHeaders["x-stack-refresh-token"] = refreshToken;
    return makeMcpReviewApi(authHeaders);
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 grid grid-cols-3 items-center">
        <div className="flex items-center justify-start">
          <h1 className="text-lg font-semibold text-gray-900">MCP Review Tool</h1>
        </div>
        {/* Tabs — centered */}
        <div className="flex justify-center">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => {
                setTab("calls");
                setSelectedRow(null);
              }}
              className={clsx(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                tab === "calls" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              MCP Review
            </button>
            <button
              onClick={() => {
                setTab("knowledge");
                setSelectedRow(null);
              }}
              className={clsx(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                tab === "knowledge" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Knowledge Base
            </button>
            <button
              onClick={() => {
                setTab("usage");
                setSelectedRow(null);
              }}
              className={clsx(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                tab === "usage" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              Unified AI Endpoint Analytics
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 justify-end">
          {tab === "knowledge" && (
            <button
              onClick={() => setShowAddQa(true)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              + Add Q&A
            </button>
          )}
          <span className="text-sm text-gray-500">{user.displayName ?? user.primaryEmail}</span>
        </div>
      </header>

      {showAddQa && (
        <AddManualQa
          onClose={() => setShowAddQa(false)}
          onSave={async (question, answer, publish) => {
            const api = await getApi();
            await api.addManual({ question, answer, publish });
          }}
        />
      )}

      <div className="flex-1 overflow-hidden flex">
        {tab === "calls" && (
          <>
            <main className="flex-1 overflow-y-auto p-6 space-y-6">
              <Analytics rows={rows} />
              <CallLogList
                rows={rows}
                connectionState={connectionState}
                onSelect={setSelectedRow}
                selectedId={selectedRow?.id}
              />
            </main>
            {currentSelectedRow && (
              <aside className="w-[480px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
                <CallLogDetail
                  row={currentSelectedRow}
                  allRows={rows}
                  onClose={() => setSelectedRow(null)}
                  onSaveCorrection={(correlationId, correctedQuestion, correctedAnswer, publish) =>
                    getApi().then(api => api.updateCorrection({ correlationId, correctedQuestion, correctedAnswer, publish }))
                  }
                  onMarkReviewed={(correlationId) =>
                    getApi().then(api => api.markReviewed({ correlationId }))
                  }
                  onUnmarkReviewed={(correlationId) =>
                    getApi().then(api => api.unmarkReviewed({ correlationId }))
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
                rows={rows}
                onSave={(correlationId, question, answer, publish) =>
                  getApi().then(api => api.updateCorrection({ correlationId, correctedQuestion: question, correctedAnswer: answer, publish }))
                }
                onDelete={(correlationId) =>
                  getApi().then(api => api.delete({ correlationId }))
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
                  onSelect={setSelectedUsageRow}
                  selectedId={selectedUsageRow?.id}
                />
              </div>
            </main>
            {selectedUsageRow && (
              <aside className="w-[480px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
                <UsageDetail
                  row={usageRows.find(r => r.id === selectedUsageRow.id) ?? selectedUsageRow}
                  onClose={() => setSelectedUsageRow(null)}
                />
              </aside>
            )}
          </>
        )}
      </div>
    </div>
  );
}
