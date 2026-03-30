"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useStackApp, useUser } from "../../lib/hooks";
import { resolveApiBaseUrl } from "../dev-tool-context";

// IF_PLATFORM react-like

const RELEASES_URL = "https://github.com/stack-auth/stack/releases";
const CHANGELOG_PATH = "/api/latest/internal/changelog";
const PRODUCTION_CHANGELOG = "https://api.stack-auth.com" + CHANGELOG_PATH;

type ChangelogEntry = {
  version: string;
  type: 'major' | 'minor' | 'patch';
  markdown: string;
  bulletCount: number;
  releasedAt?: string;
  isUnreleased?: boolean;
};

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function generateRandomEmail() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `dev-${id}@test.stack-auth.com`;
}

/* ------------------------------------------------------------------ */
/*  User hero card                                                     */
/* ------------------------------------------------------------------ */

function UserHeroCard() {
  const app = useStackApp();
  const user = useUser();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleQuickSignIn = async () => {
    if (!isLocalhost()) {
      setStatus({ type: 'error', message: 'Quick sign-in is only available on localhost' });
      return;
    }
    setLoading(true);
    setStatus(null);
    const randomEmail = generateRandomEmail();
    try {
      const signUpResult = await app.signUpWithCredential({ email: randomEmail, password: randomEmail, noRedirect: true, noVerificationCallback: true });
      if (signUpResult.status === 'error') {
        setStatus({ type: 'error', message: `Sign up failed: ${signUpResult.error.message}` });
        setLoading(false);
        return;
      }
      const signInResult = await app.signInWithCredential({ email: randomEmail, password: randomEmail, noRedirect: true });
      if (signInResult.status === 'error') {
        setStatus({ type: 'error', message: `Sign in failed: ${signInResult.error.message}` });
      } else {
        setStatus({ type: 'success', message: `Signed in as ${randomEmail}` });
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Unknown error' });
    }
    setLoading(false);
  };

  const handleSignInAs = async (targetEmail: string) => {
    if (!targetEmail.trim()) return;
    if (!isLocalhost()) {
      setStatus({ type: 'error', message: 'Quick sign-in is only available on localhost' });
      return;
    }
    setLoading(true);
    setStatus(null);
    const trimmed = targetEmail.trim();
    try {
      const signInResult = await app.signInWithCredential({ email: trimmed, password: trimmed, noRedirect: true });
      if (signInResult.status === 'ok') {
        setStatus({ type: 'success', message: `Signed in as ${trimmed}` });
        setEmail('');
        setLoading(false);
        return;
      }
      const signUpResult = await app.signUpWithCredential({ email: trimmed, password: trimmed, noRedirect: true, noVerificationCallback: true });
      if (signUpResult.status === 'error') {
        setStatus({ type: 'error', message: `Failed: ${signUpResult.error.message}` });
        setLoading(false);
        return;
      }
      const retryResult = await app.signInWithCredential({ email: trimmed, password: trimmed, noRedirect: true });
      if (retryResult.status === 'error') {
        setStatus({ type: 'error', message: `Sign in failed: ${retryResult.error.message}` });
      } else {
        setStatus({ type: 'success', message: `Signed in as ${trimmed}` });
        setEmail('');
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Unknown error' });
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    setLoading(true);
    setStatus(null);
    try {
      await user!.signOut();
      setStatus({ type: 'success', message: 'Signed out' });
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Sign out failed' });
    }
    setLoading(false);
  };

  const initials = user
    ? (user.displayName || user.primaryEmail || '?').split(' ').map((s: string) => s[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  return (
    <div className="sdt-ov-card sdt-ov-card-hero">
      <div className="sdt-ov-label">Identity</div>
      <div className="sdt-ov-user-row">
        <div className={`sdt-ov-avatar ${user ? 'sdt-ov-avatar-active' : ''}`}>
          {user?.profileImageUrl ? (
            <img src={user.profileImageUrl} alt="" />
          ) : (
            initials
          )}
        </div>
        <div className="sdt-ov-user-meta">
          <div className="sdt-ov-user-name">{user ? (user.displayName || 'Anonymous') : 'No user signed in'}</div>
          <div className="sdt-ov-user-email">{user ? (user.primaryEmail || 'No email') : 'Sign in to test auth flows'}</div>
          {user && <div className="sdt-ov-auth-indicator">Authenticated</div>}
        </div>
      </div>
      <div className="sdt-ov-actions">
        {user ? (
          <>
            <button className="sdt-ov-btn sdt-ov-btn-danger" onClick={() => runAsynchronously(handleSignOut())} disabled={loading}>Sign Out</button>
            <button className="sdt-ov-btn sdt-ov-btn-primary" onClick={() => runAsynchronously(handleQuickSignIn())} disabled={loading}>Random User</button>
          </>
        ) : (
          <button className="sdt-ov-btn sdt-ov-btn-primary sdt-ov-btn-wide" onClick={() => runAsynchronously(handleQuickSignIn())} disabled={loading}>
            {loading ? 'Working\u2026' : 'Quick Sign In'}
          </button>
        )}
        <div className="sdt-ov-email-input">
          <input
            type="email"
            placeholder={user ? "Switch to email\u2026" : "Sign in as email\u2026"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runAsynchronously(handleSignInAs(email)); }}
            disabled={loading}
          />
          <button onClick={() => runAsynchronously(handleSignInAs(email))} disabled={loading || !email.trim()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
          </button>
        </div>
      </div>
      {status && (
        <div className={`sdt-ov-toast sdt-ov-toast-${status.type}`}>{status.message}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth methods card (derived from project config)                    */
/* ------------------------------------------------------------------ */

function AuthMethodsCardInner() {
  const app = useStackApp();
  const project = app.useProject();
  const config = project.config;

  const methods = useMemo(() => [
    { id: 'credential', label: 'Password', enabled: config.credentialEnabled, icon: '\u{1F511}' },
    { id: 'magic-link', label: 'Magic Link', enabled: config.magicLinkEnabled, icon: '\u2728' },
    { id: 'passkey', label: 'Passkey', enabled: config.passkeyEnabled, icon: '\u{1F9EC}' },
  ], [config]);

  const oauthProviders = config.oauthProviders;

  return (
    <div className="sdt-ov-card sdt-ov-card-auth">
      <div className="sdt-ov-label">Config</div>
      <div className="sdt-ov-auth-grid">
        {methods.map((m) => (
          <div key={m.id} className={`sdt-ov-method ${m.enabled ? 'sdt-ov-method-on' : 'sdt-ov-method-off'}`}>
            <span className="sdt-ov-method-name">{m.label}</span>
          </div>
        ))}
        {oauthProviders.map((p) => (
          <div key={p.id} className="sdt-ov-method sdt-ov-method-on sdt-ov-method-oauth">
            <span className="sdt-ov-method-name">{p.id}</span>
          </div>
        ))}
        {!config.signUpEnabled && (
          <div className="sdt-ov-method sdt-ov-method-warn">
            <span className="sdt-ov-method-name">Sign-up off</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigCardSkeleton() {
  return (
    <div className="sdt-ov-card sdt-ov-card-auth">
      <div className="sdt-ov-label">Config</div>
      <div className="sdt-ov-auth-grid">
        {[1, 2, 3].map((i) => (
          <div key={i} className="sdt-ov-method sdt-ov-skeleton-pill" />
        ))}
      </div>
    </div>
  );
}

function ConfigCard() {
  return (
    <Suspense fallback={<ConfigCardSkeleton />}>
      <AuthMethodsCardInner />
    </Suspense>
  );
}

/* ------------------------------------------------------------------ */
/*  Main overview                                                      */
/* ------------------------------------------------------------------ */

function ChecklistCard({ projectId, user }: { projectId: string; user: unknown }) {
  const checks = [
    { ok: !!projectId && projectId !== 'default', label: 'Project', icon: '\u{1F4E6}' },
    { ok: true, label: 'Provider', icon: '\u26A1' },
    { ok: !!user, label: 'Auth', icon: '\u{1F464}' },
  ];
  const passCount = checks.filter((c) => c.ok).length;
  const allGood = passCount === checks.length;
  return (
    <div className={`sdt-ov-card sdt-ov-card-checks ${allGood ? 'sdt-ov-card-checks-ok' : ''}`}>
      <div className="sdt-ov-checks-header">
        <div className="sdt-ov-label" style={{ marginBottom: 0 }}>Setup</div>
        <span className={`sdt-ov-checks-badge ${allGood ? 'sdt-ov-checks-badge-ok' : 'sdt-ov-checks-badge-warn'}`}>
          {allGood ? 'All good' : `${passCount}/${checks.length}`}
        </span>
      </div>
      <div className="sdt-ov-checks-bar">
        <div className="sdt-ov-checks-bar-fill" style={{ width: `${(passCount / checks.length) * 100}%` }} />
      </div>
      <div className="sdt-ov-checks">
        {checks.map((c, i) => (
          <div key={i} className={`sdt-ov-check ${c.ok ? 'sdt-ov-check-ok' : 'sdt-ov-check-warn'}`}>
            <span className="sdt-ov-check-icon">{c.ok ? '\u2713' : '!'}</span>
            <span className="sdt-ov-check-label">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Changelog (fetched from Stack Auth API, same as dashboard)         */
/* ------------------------------------------------------------------ */

function ChangelogCard() {
  const app = useStackApp();
  const apiBaseUrl = resolveApiBaseUrl(app);
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();

    async function tryFetchChangelog(url: string): Promise<ChangelogEntry[]> {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) return [];
      const payload = await res.json();
      const entries: ChangelogEntry[] | undefined = payload.entries;
      return entries ?? [];
    }

    runAsynchronously((async () => {
      try {
        // Try the app's own API first (has local CHANGELOG.md in dev),
        // fall back to production if it returns empty or fails.
        let fetched: ChangelogEntry[] = [];
        try {
          fetched = await tryFetchChangelog(apiBaseUrl + CHANGELOG_PATH);
        } catch {
          // local API unavailable, will try production
        }
        if (fetched.length === 0) {
          fetched = await tryFetchChangelog(PRODUCTION_CHANGELOG);
        }
        if (abort.signal.aborted) return;
        setEntries(fetched);
        if (fetched.length > 0) {
          setExpandedVersion(fetched[0].version);
        }
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })());
    return () => abort.abort();
  }, [apiBaseUrl]);

  /** Strip markdown images (they won't render well in the tiny panel) */
  function stripImages(md: string): string {
    return md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  }

  function renderChangelogMarkdown(md: string): React.ReactNode[] {
    const cleaned = stripImages(md);
    const lines = cleaned.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Headings (### only, ## is version heading handled above)
      const headingMatch = line.match(/^###\s+(.+)/);
      if (headingMatch) {
        elements.push(
          <div key={i} style={{ fontWeight: 600, color: 'var(--sdt-text)', marginTop: elements.length > 0 ? 8 : 0, marginBottom: 4, fontSize: 12 }}>
            {headingMatch[1]}
          </div>
        );
        i++;
        continue;
      }

      // Bullet list
      if (line.match(/^- /)) {
        const items: { key: number; text: string }[] = [];
        while (i < lines.length && lines[i].match(/^- /)) {
          items.push({ key: i, text: lines[i].replace(/^- /, '') });
          i++;
        }
        elements.push(
          <ul key={`ul-${items[0].key}`} style={{ margin: '2px 0', paddingLeft: 16, listStyleType: 'disc' }}>
            {items.map((item) => (
              <li key={item.key} style={{ fontSize: 12, color: 'var(--sdt-text-secondary)', lineHeight: 1.6 }}>
                {renderInlineMarkdown(item.text)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Paragraph
      elements.push(
        <div key={i} style={{ fontSize: 12, color: 'var(--sdt-text-secondary)', lineHeight: 1.6 }}>
          {renderInlineMarkdown(line)}
        </div>
      );
      i++;
    }

    return elements;
  }

  function renderInlineMarkdown(text: string): React.ReactNode {
    // Bold, inline code, links
    const parts: React.ReactNode[] = [];
    const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[1]) {
        parts.push(<code key={match.index} style={{ background: 'var(--sdt-bg-hover)', padding: '1px 4px', borderRadius: 3, fontSize: 11, fontFamily: 'var(--sdt-font-mono)' }}>{match[1].slice(1, -1)}</code>);
      } else if (match[2]) {
        parts.push(<strong key={match.index}>{match[2].slice(2, -2)}</strong>);
      } else if (match[3]) {
        parts.push(<a key={match.index} href={match[5]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sdt-accent)' }}>{match[4]}</a>);
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  }

  return (
    <div className="sdt-ov-card sdt-ov-card-changelog">
      <div className="sdt-ov-label">What's New</div>
      {loading && (
        <div style={{ padding: '12px 0', color: 'var(--sdt-text-tertiary)', fontSize: 12 }}>Loading changelog...</div>
      )}
      {error && (
        <div style={{ padding: '12px 0', color: 'var(--sdt-text-tertiary)', fontSize: 12 }}>Could not load changelog.</div>
      )}
      {!loading && !error && (
        <div className="sdt-ov-changelog">
          {entries.slice(0, 5).map((entry) => {
            const isExpanded = expandedVersion === entry.version;
            return (
              <div key={entry.version} className="sdt-ov-release">
                <div
                  className="sdt-ov-release-head"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setExpandedVersion(isExpanded ? null : entry.version)}
                >
                  {entry.version}
                  {entry.releasedAt && <span className="sdt-ov-release-date">{entry.releasedAt}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--sdt-text-tertiary)' }}>
                    {isExpanded ? '\u25B2' : '\u25BC'}
                  </span>
                </div>
                {isExpanded && (
                  <div className="sdt-ov-release-body" style={{ padding: '4px 0 8px' }}>
                    {renderChangelogMarkdown(entry.markdown)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <a className="sdt-ov-all-releases" href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
        All releases
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
      </a>
    </div>
  );
}

export function OverviewTab() {
  const app = useStackApp();
  const user = useUser();

  const projectId = app.projectId;
  const sdkVersion = app.version;

  return (
    <div className="sdt-ov">
      <UserHeroCard />
      <div className="sdt-ov-card sdt-ov-card-project">
        <div className="sdt-ov-label">Project</div>
        <div className="sdt-ov-project-rows">
          <div className="sdt-ov-project-row">
            <span className="sdt-ov-project-key">SDK</span>
            <span className="sdt-ov-project-val">{sdkVersion || '?'}</span>
          </div>
          <div className="sdt-ov-project-row">
            <span className="sdt-ov-project-key">Project ID</span>
            <span className="sdt-ov-project-val sdt-ov-project-val-mono">{projectId || 'N/A'}</span>
          </div>
          <div className="sdt-ov-project-row">
            <span className="sdt-ov-project-key">Environment</span>
            <span className="sdt-ov-project-val"><span className="sdt-ov-pulse-dot" />Development</span>
          </div>
        </div>
      </div>

      <ConfigCard />
      <ChecklistCard projectId={projectId} user={user} />

      <ChangelogCard />
    </div>
  );
}

// END_PLATFORM
