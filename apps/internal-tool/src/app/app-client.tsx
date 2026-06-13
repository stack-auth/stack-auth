import { useUser } from "@hexclave/next";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddManualQa } from "../components/AddManualQa";
import { Analytics } from "../components/Analytics";
import { CallLogDetail } from "../components/CallLogDetail";
import { CallLogList } from "../components/CallLogList";
import { KnowledgeBase } from "../components/KnowledgeBase";
import { Usage } from "../components/Usage";
import { UsageDetail } from "../components/UsageDetail";
import { type GetSpacetimeBrowserSession, type SpacetimeBrowserSession, useAiQueryLogs, useMcpCallLogs, useQaEntries } from "../hooks/useSpacetimeDB";
import { makeMcpReviewApi, requestSpacetimeBrowserSession } from "../lib/mcp-review-api";
import type { AiQueryLogRow, McpCallLogRow } from "../types";

type Tab = "calls" | "knowledge" | "usage";
const TAB_STORAGE_KEY = "internal-tool-active-tab";
const VALID_TABS: readonly Tab[] = ["calls", "knowledge", "usage"];
const dashboardUrl = process.env.NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL ?? process.env.NEXT_PUBLIC_STACK_DASHBOARD_URL;
const SPACETIME_BROWSER_SESSION_INDEX_PREFIX = "internal-tool-spacetimedb-browser-session";

type StoredSpacetimeBrowserSession = {
  identity: string,
  token: string,
  scopeKey: string,
};

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

function tokenIndexKey(stackUserId: string): string {
  return `${SPACETIME_BROWSER_SESSION_INDEX_PREFIX}:${stackUserId}`;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function readStoredSpacetimeBrowserSession(stackUserId: string): StoredSpacetimeBrowserSession | null {
  const scopeKey = window.localStorage.getItem(tokenIndexKey(stackUserId));
  if (scopeKey == null) return null;
  const raw = window.localStorage.getItem(scopeKey);
  if (raw == null) return null;
  const parsed: unknown = JSON.parse(raw);
  const identity = readStringProperty(parsed, "identity");
  const token = readStringProperty(parsed, "token");
  const storedScopeKey = readStringProperty(parsed, "scopeKey");
  if (identity == null || token == null || storedScopeKey !== scopeKey) {
    window.localStorage.removeItem(scopeKey);
    window.localStorage.removeItem(tokenIndexKey(stackUserId));
    return null;
  }
  return { identity, token, scopeKey };
}

function writeStoredSpacetimeBrowserSession(stackUserId: string, session: SpacetimeBrowserSession): void {
  window.localStorage.setItem(session.scopeKey, JSON.stringify({
    identity: session.identity,
    token: session.token,
    scopeKey: session.scopeKey,
  }));
  window.localStorage.setItem(tokenIndexKey(stackUserId), session.scopeKey);
  window.localStorage.removeItem(`spacetimedb_${session.host}/${session.dbName}/auth_token`);
}

function clearStoredSpacetimeBrowserSession(stackUserId: string): void {
  const scopeKey = window.localStorage.getItem(tokenIndexKey(stackUserId));
  if (scopeKey != null) {
    window.localStorage.removeItem(scopeKey);
  }
  window.localStorage.removeItem(tokenIndexKey(stackUserId));
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
  const browserSessionRequestRef = useRef<{ promise: Promise<SpacetimeBrowserSession>, refresh: boolean } | null>(null);
  const getAuthHeaders = useCallback(async () => {
    if (!user) throw new Error("Not authenticated");
    const { accessToken, refreshToken } = await user.getAuthJson();
    const authHeaders: Record<string, string> = {};
    if (accessToken) authHeaders["x-hexclave-access-token"] = accessToken;
    if (refreshToken) authHeaders["x-hexclave-refresh-token"] = refreshToken;
    return authHeaders;
  }, [user]);
  const getSpacetimeBrowserSession = useCallback<GetSpacetimeBrowserSession>(async (options) => {
    if (!user) throw new Error("Not authenticated");
    const refresh = options?.refresh ?? false;
    const existingRequest = browserSessionRequestRef.current;
    if (existingRequest && (!refresh || existingRequest.refresh)) {
      return await existingRequest.promise;
    }

    const promise = (async () => {
      const authHeaders = await getAuthHeaders();
      if (refresh) {
        clearStoredSpacetimeBrowserSession(user.id);
      }

      const stored = refresh ? null : readStoredSpacetimeBrowserSession(user.id);
      if (stored != null) {
        const cachedSession = await requestSpacetimeBrowserSession({ cachedIdentity: stored.identity }, authHeaders);
        if (cachedSession.scopeKey === stored.scopeKey) {
          return {
            host: cachedSession.host,
            dbName: cachedSession.dbName,
            identity: stored.identity,
            token: stored.token,
            scopeKey: stored.scopeKey,
          };
        }
        clearStoredSpacetimeBrowserSession(user.id);
      }

      const minted = await requestSpacetimeBrowserSession({}, authHeaders);
      if (minted.token == null) {
        throw new Error("SpacetimeDB browser session API did not return a token for a fresh session");
      }
      const session = {
        host: minted.host,
        dbName: minted.dbName,
        identity: minted.identity,
        token: minted.token,
        scopeKey: minted.scopeKey,
      };
      writeStoredSpacetimeBrowserSession(user.id, session);
      return session;
    })();

    const request = { promise, refresh };
    browserSessionRequestRef.current = request;
    try {
      return await promise;
    } finally {
      if (browserSessionRequestRef.current === request) {
        browserSessionRequestRef.current = null;
      }
    }
  }, [getAuthHeaders, user]);
  const isAiChatReviewer = Boolean(
    (user?.clientReadOnlyMetadata as Record<string, unknown> | null)?.isAiChatReviewer,
  );
  const memoizedGetSpacetimeBrowserSession = useMemo(
    () => (user && isAiChatReviewer) ? getSpacetimeBrowserSession : undefined,
    [user, isAiChatReviewer, getSpacetimeBrowserSession],
  );

  const { rows, connectionState, connectionErrorMessage } = useMcpCallLogs(memoizedGetSpacetimeBrowserSession);
  const { rows: usageRows, connectionState: usageConnectionState } = useAiQueryLogs(memoizedGetSpacetimeBrowserSession);
  const { rows: qaRows } = useQaEntries(memoizedGetSpacetimeBrowserSession);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">MCP Review Tool</h1>
          <p className="text-sm text-gray-500 mb-4">
            Sign in to the{" "}
            <a href={dashboardUrl} className="text-blue-600 underline" target="_blank" rel="noreferrer">
              Hexclave Dashboard
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

  if (!isAiChatReviewer) {
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

  async function getApi() {
    return makeMcpReviewApi(await getAuthHeaders());
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
          onSave={async (question, answer, publish, requestId) => {
            const api = await getApi();
            await api.addManual({ question, answer, publish, requestId });
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
              <aside className="w-[480px] shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
                <CallLogDetail
                  row={currentSelectedRow}
                  allRows={rows}
                  qaEntries={qaRows}
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
                  onRetryReview={(correlationId, payload) =>
                    getApi().then(api => api.retryReview({ correlationId, ...payload }))
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
                onSave={(qaId, question, answer, publish) =>
                  getApi().then(api => api.updateQaEntry({ qaId: qaId.toString(), question, answer, publish }))
                }
                onDelete={(qaId) =>
                  getApi().then(api => api.delete({ qaId: qaId.toString() }))
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
