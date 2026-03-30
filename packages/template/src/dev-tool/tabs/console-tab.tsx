"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDevToolContext, type ConsoleSubTab, type ApiLogEntry, type EventLogEntry } from "../dev-tool-context";
import { DevToolTabBar, type TabDef } from "../dev-tool-tab-bar";
import { useStackApp } from "../../lib/hooks";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";

// IF_PLATFORM react-like

const SUB_TABS: TabDef<ConsoleSubTab>[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'config', label: 'Config' },
];

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

type MergedLogEntry =
  | { kind: 'api'; entry: ApiLogEntry }
  | { kind: 'event'; entry: EventLogEntry };

const EVENT_TYPE_STYLES: Record<string, string> = {
  'sign-in': 'sdt-badge-success',
  'sign-up': 'sdt-badge-success',
  'sign-out': 'sdt-badge-warning',
  'token-refresh': 'sdt-badge-info',
  'error': 'sdt-badge-error',
  'info': 'sdt-badge-info',
};

function MergedLogsList() {
  const { apiLogs, eventLogs } = useDevToolContext();

  const merged = useMemo<MergedLogEntry[]>(() => {
    const all: MergedLogEntry[] = [
      ...apiLogs.map((e) => ({ kind: 'api' as const, entry: e })),
      ...eventLogs.map((e) => ({ kind: 'event' as const, entry: e })),
    ];
    all.sort((a, b) => b.entry.timestamp - a.entry.timestamp);
    return all;
  }, [apiLogs, eventLogs]);

  if (merged.length === 0) {
    return (
      <div className="sdt-empty-state">
        <div className="sdt-empty-state-icon">{'\uD83D\uDCCB'}</div>
        <div>No logs recorded yet</div>
        <div style={{ fontSize: '12px', color: 'var(--sdt-text-tertiary)' }}>
          API calls and auth events will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="sdt-log-list">
      {merged.map((item) => {
        if (item.kind === 'api') {
          const log = item.entry;
          return (
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
          );
        } else {
          const log = item.entry;
          return (
            <div key={log.id} className="sdt-log-item">
              <span className="sdt-log-time">{formatTimestamp(log.timestamp)}</span>
              <span className={`sdt-badge ${EVENT_TYPE_STYLES[log.type] || 'sdt-badge-info'}`}>
                {log.type}
              </span>
              <span className="sdt-log-message">{log.message}</span>
            </div>
          );
        }
      })}
    </div>
  );
}

function ProjectConfigInfo() {
  const app = useStackApp();
  const project = app.useProject();

  const configItems = useMemo(() => {
    const items: [string, string][] = [];
    items.push(['Project ID', project.id]);
    items.push(['Display Name', project.displayName]);
    items.push(['Sign-Up Enabled', String(project.config.signUpEnabled)]);
    items.push(['Credential Auth', String(project.config.credentialEnabled)]);
    items.push(['Magic Link', String(project.config.magicLinkEnabled)]);
    items.push(['Passkey', String(project.config.passkeyEnabled)]);
    items.push(['Client Team Creation', String(project.config.clientTeamCreationEnabled)]);
    items.push(['Client User Deletion', String(project.config.clientUserDeletionEnabled)]);
    items.push(['User API Keys', String(project.config.allowUserApiKeys)]);
    items.push(['Team API Keys', String(project.config.allowTeamApiKeys)]);
    if (project.config.oauthProviders.length > 0) {
      items.push(['OAuth Providers', project.config.oauthProviders.map((p) => p.id).join(', ')]);
    } else {
      items.push(['OAuth Providers', 'None']);
    }
    return items;
  }, [project]);

  return (
    <table className="sdt-config-table">
      <tbody>
        {configItems.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td>
              {value === 'true' ? (
                <span style={{ color: 'var(--sdt-success)' }}>Enabled</span>
              ) : value === 'false' ? (
                <span style={{ color: 'var(--sdt-text-tertiary)' }}>Disabled</span>
              ) : (
                value
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildExportContent(
  apiLogs: ApiLogEntry[],
  eventLogs: EventLogEntry[],
  projectConfig: { id: string; displayName: string; config: Record<string, unknown> },
): string {
  const lines: string[] = [];
  lines.push('=== Stack Auth Dev Tool Report ===');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('--- Project Config ---');
  lines.push(`Project ID: ${projectConfig.id}`);
  lines.push(`Display Name: ${projectConfig.displayName}`);
  for (const [key, value] of Object.entries(projectConfig.config)) {
    if (key === 'oauthProviders' && Array.isArray(value)) {
      lines.push(`${key}: ${value.map((p: any) => p.id).join(', ') || 'None'}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('');

  lines.push(`--- Environment ---`);
  lines.push(`SDK Version: ${typeof window !== 'undefined' ? (window as any).__STACK_VERSION__ || 'Unknown' : 'Unknown'}`);
  lines.push(`Environment: ${typeof window !== 'undefined' ? (window.location.hostname === 'localhost' ? 'development' : 'production') : 'unknown'}`);
  lines.push(`URL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}`);
  lines.push(`User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}`);
  lines.push('');

  if (apiLogs.length > 0) {
    lines.push(`--- API Calls (${apiLogs.length}) ---`);
    for (const log of apiLogs.slice(0, 50)) {
      const status = log.status !== undefined ? ` [${log.status}]` : '';
      const duration = log.duration !== undefined ? ` ${log.duration}ms` : '';
      lines.push(`${new Date(log.timestamp).toISOString()} ${log.method} ${log.url}${status}${duration}`);
    }
    if (apiLogs.length > 50) {
      lines.push(`... and ${apiLogs.length - 50} more`);
    }
    lines.push('');
  }

  if (eventLogs.length > 0) {
    lines.push(`--- Events (${eventLogs.length}) ---`);
    for (const log of eventLogs.slice(0, 50)) {
      lines.push(`${new Date(log.timestamp).toISOString()} [${log.type}] ${log.message}`);
    }
    if (eventLogs.length > 50) {
      lines.push(`... and ${eventLogs.length - 50} more`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const { apiLogs, eventLogs, setState } = useDevToolContext();
  const app = useStackApp();
  const project = app.useProject();
  const [copied, setCopied] = useState(false);

  const content = useMemo(() => buildExportContent(apiLogs, eventLogs, {
    id: project.id,
    displayName: project.displayName,
    config: project.config as unknown as Record<string, unknown>,
  }), [apiLogs, eventLogs, project]);

  const handleCopy = useCallback(() => {
    runAsynchronouslyWithAlert(navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }));
  }, [content]);

  const handleSupportBugReport = useCallback(() => {
    setState((prev) => ({
      ...prev,
      activeTab: 'support',
      showExportDialog: false,
      supportPrefill: {
        feedbackType: 'bug',
        message: `Describe the issue:\n\n\n--- Debug info (auto-attached) ---\n${content}`,
      },
    }));
    onClose();
  }, [content, setState, onClose]);

  return (
    <div className="sdt-share-overlay" onClick={onClose}>
      <div className="sdt-share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="sdt-share-header">
          <span className="sdt-share-title">Export Debug Info</span>
          <button className="sdt-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="11" y2="11" />
              <line x1="11" y1="3" x2="3" y2="11" />
            </svg>
          </button>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--sdt-text-secondary)', lineHeight: 1.5 }}>
          Copy your logs and config to clipboard, then share via one of the channels below.
        </div>

        <button
          className={`sdt-share-action-btn ${copied ? 'sdt-share-action-btn-accent' : ''}`}
          onClick={handleCopy}
          style={{ justifyContent: 'center' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {copied
              ? <path d="M20 6L9 17l-5-5"/>
              : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
            }
          </svg>
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>

        <div className="sdt-share-actions">
          <a
            href="https://discord.stack-auth.com"
            target="_blank"
            rel="noopener noreferrer"
            className="sdt-share-action-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Discord
          </a>
          <a
            href="https://github.com/stack-auth/stack-auth/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="sdt-share-action-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub Issue
          </a>
          <button className="sdt-share-action-btn sdt-share-action-btn-accent" onClick={handleSupportBugReport}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/>
              <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/>
              <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M6 17H3M21 5c0 2.1-1.6 3.8-3.53 4M18 13h4M21 17h-3"/>
            </svg>
            Bug Report
          </button>
        </div>
      </div>
    </div>
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
      {activeSubTab === 'logs' && <MergedLogsList />}
      {activeSubTab === 'config' && <ProjectConfigInfo />}
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  return <ShareDialog onClose={onClose} />;
}

export function ConsoleTab() {
  const { state, setState, clearLogs } = useDevToolContext();

  const setSubTab = useCallback((subTab: ConsoleSubTab) => {
    setState((prev) => ({ ...prev, consoleSubTab: subTab }));
  }, [setState]);

  const trailingButtons = (
    <>
      <button
        className="sdt-close-btn"
        onClick={() => setState((prev) => ({ ...prev, showExportDialog: true }))}
        title="Export logs & config"
        style={{ fontSize: '11px', width: 'auto', padding: '0 8px' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        Export
      </button>
      {state.consoleSubTab === 'logs' && (
        <button
          className="sdt-close-btn"
          onClick={clearLogs}
          title="Clear logs"
          style={{ fontSize: '11px', width: 'auto', padding: '0 8px' }}
        >
          Clear
        </button>
      )}
    </>
  );

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <DevToolTabBar
          tabs={SUB_TABS}
          activeTab={state.consoleSubTab}
          onTabChange={setSubTab}
          variant="pills"
          trailing={trailingButtons}
        />
      </div>

      <ConsoleSubContent activeSubTab={state.consoleSubTab} />
    </>
  );
}

// END_PLATFORM
