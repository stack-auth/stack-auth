"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevToolContext, type ConsoleSubTab } from "../dev-tool-context";
import { DevToolTabBar, type TabDef } from "../dev-tool-tab-bar";
import { useStackApp, useUser } from "../../lib/hooks";

// IF_PLATFORM react-like

const SUB_TABS: TabDef<ConsoleSubTab>[] = [
  { id: 'console', label: 'API Calls' },
  { id: 'events', label: 'Events' },
  { id: 'info', label: 'Config' },
];

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function ApiCallsList() {
  const { apiLogs } = useDevToolContext();

  if (apiLogs.length === 0) {
    return (
      <div className="sdt-empty-state">
        <div className="sdt-empty-state-icon">{'\uD83D\uDCE1'}</div>
        <div>No API calls recorded yet</div>
        <div style={{ fontSize: '12px', color: 'var(--sdt-text-tertiary)' }}>
          API calls to Stack Auth will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="sdt-log-list">
      {apiLogs.map((log) => (
        <div key={log.id} className="sdt-log-item">
          <span className="sdt-log-time">{formatTimestamp(log.timestamp)}</span>
          <span className={`sdt-log-method sdt-log-method-${log.method.toLowerCase()}`}>
            {log.method}
          </span>
          <span className="sdt-log-url">{log.url}</span>
          {log.status !== undefined && (
            <span className={`sdt-log-status ${log.status < 400 ? 'sdt-log-status-ok' : 'sdt-log-status-err'}`}>
              {log.status}
            </span>
          )}
          {log.duration !== undefined && (
            <span className="sdt-log-time">{log.duration}ms</span>
          )}
        </div>
      ))}
    </div>
  );
}

function EventsList() {
  const { eventLogs } = useDevToolContext();

  if (eventLogs.length === 0) {
    return (
      <div className="sdt-empty-state">
        <div className="sdt-empty-state-icon">{'\uD83D\uDCCB'}</div>
        <div>No events recorded yet</div>
        <div style={{ fontSize: '12px', color: 'var(--sdt-text-tertiary)' }}>
          Auth events like sign-in, sign-out will appear here
        </div>
      </div>
    );
  }

  const typeStyles: Record<string, string> = {
    'sign-in': 'sdt-badge-success',
    'sign-up': 'sdt-badge-success',
    'sign-out': 'sdt-badge-warning',
    'token-refresh': 'sdt-badge-info',
    'error': 'sdt-badge-error',
    'info': 'sdt-badge-info',
  };

  return (
    <div className="sdt-log-list">
      {eventLogs.map((log) => (
        <div key={log.id} className="sdt-log-item">
          <span className="sdt-log-time">{formatTimestamp(log.timestamp)}</span>
          <span className={`sdt-badge ${typeStyles[log.type] || 'sdt-badge-info'}`}>
            {log.type}
          </span>
          <span className="sdt-log-message">{log.message}</span>
        </div>
      ))}
    </div>
  );
}

function ConfigInfo() {
  const app = useStackApp();
  const user = useUser();

  const configItems = useMemo(() => {
    const items: [string, string | null | undefined][] = [];
    items.push(['Project ID', app.projectId || 'Not configured']);
    items.push(['SDK Version', app.version || 'Unknown']);
    items.push(['Environment', process.env.NODE_ENV]);
    items.push(['User Signed In', user ? 'Yes' : 'No']);
    if (user) {
      items.push(['User ID', user.id]);
      items.push(['User Email', user.primaryEmail]);
      if (user.displayName != null) {
        items.push(['Display Name', user.displayName]);
      }
    }
    items.push(['Window Location', typeof window !== 'undefined' ? window.location.href : 'N/A']);
    items.push(['User Agent', typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 100) : 'N/A']);
    return items;
  }, [app, user]);

  return (
    <table className="sdt-config-table">
      <tbody>
        {configItems.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>{value ?? 'N/A'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsoleSubContent({ activeSubTab }: { activeSubTab: ConsoleSubTab }) {
  const [animKey, setAnimKey] = useState(0);
  const prevRef = useRef(activeSubTab);

  useEffect(() => {
    if (prevRef.current !== activeSubTab) {
      setAnimKey((k) => k + 1);
      prevRef.current = activeSubTab;
    }
  }, [activeSubTab]);

  return (
    <div className="sdt-tab-content-fade" data-anim-key={animKey}>
      {activeSubTab === 'console' && <ApiCallsList />}
      {activeSubTab === 'events' && <EventsList />}
      {activeSubTab === 'info' && <ConfigInfo />}
    </div>
  );
}

export function ConsoleTab() {
  const { state, setState, clearLogs } = useDevToolContext();

  const setSubTab = useCallback((subTab: ConsoleSubTab) => {
    setState((prev) => ({ ...prev, consoleSubTab: subTab }));
  }, [setState]);

  const clearButton = state.consoleSubTab !== 'info' ? (
    <button
      className="sdt-close-btn"
      onClick={clearLogs}
      title="Clear logs"
      style={{ fontSize: '11px', width: 'auto', padding: '0 8px' }}
    >
      Clear
    </button>
  ) : undefined;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <DevToolTabBar
          tabs={SUB_TABS}
          activeTab={state.consoleSubTab}
          onTabChange={setSubTab}
          variant="pills"
          trailing={clearButton}
        />
      </div>

      <ConsoleSubContent activeSubTab={state.consoleSubTab} />
    </>
  );
}

// END_PLATFORM
