"use client";

import React, { Suspense, useMemo, useState } from "react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useStackApp, useUser } from "../../lib/hooks";

// IF_PLATFORM react-like

const CHANGELOG: {
  version: string;
  date: string;
  entries: { tag: 'feature' | 'fix' | 'breaking' | 'improvement'; text: string }[];
}[] = [
  {
    version: "2.8.0",
    date: "2025-03-20",
    entries: [
      { tag: 'feature', text: "New dev tool panel with component inspector, console, and live preview" },
      { tag: 'feature', text: "AI-powered support assistant integrated into dev tool" },
      { tag: 'improvement', text: "Automatic API call and auth event logging" },
    ],
  },
  {
    version: "2.7.5",
    date: "2025-03-12",
    entries: [
      { tag: 'fix', text: "Fixed connected accounts not appearing after OAuth redirect" },
      { tag: 'improvement', text: "Improved token refresh reliability during background tabs" },
    ],
  },
  {
    version: "2.7.0",
    date: "2025-02-28",
    entries: [
      { tag: 'feature', text: "Added connected accounts support to user profile" },
      { tag: 'improvement', text: "Better error messages for misconfigured project IDs" },
      { tag: 'fix', text: "Resolved hydration mismatch in StackProvider with SSR" },
    ],
  },
];

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

export function OverviewTab() {
  const app = useStackApp();
  const user = useUser();

  const projectId = app.projectId;
  const sdkVersion = app.version;
  const latestVersion = CHANGELOG[0]?.version;
  const isOutdated = !!(sdkVersion && latestVersion && sdkVersion !== latestVersion && compareVersions(sdkVersion, latestVersion) < 0);
  const missedFix = isOutdated && sdkVersion && CHANGELOG.some(
    (release) => compareVersions(release.version, sdkVersion) > 0 && release.entries.some((e) => e.tag === 'fix')
  );


  return (
    <div className="sdt-ov">
      <UserHeroCard />
      <div className="sdt-ov-card sdt-ov-card-project">
        <div className="sdt-ov-label">Project</div>
        <div className="sdt-ov-project-rows">
          <div className="sdt-ov-project-row">
            <span className="sdt-ov-project-key">SDK</span>
            <span className="sdt-ov-project-val">
              {sdkVersion || '?'}
              {isOutdated && (
                <span className={`sdt-ov-sdk-badge ${missedFix ? 'sdt-ov-sdk-badge-error' : ''}`}>
                  {missedFix ? 'fix available' : 'update'}
                </span>
              )}
            </span>
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

      {/* Changelog — spans 2 cols */}
      <div className="sdt-ov-card sdt-ov-card-changelog">
        <div className="sdt-ov-label">What's New</div>
        <div className="sdt-ov-changelog">
          {CHANGELOG.map((release) => (
            <div key={release.version} className="sdt-ov-release">
              <div className="sdt-ov-release-head">v{release.version}<span className="sdt-ov-release-date">{release.date}</span></div>
              {release.entries.map((entry, j) => (
                <div key={j} className="sdt-ov-release-line">
                  <span className={`sdt-ov-tag sdt-ov-tag-${entry.tag}`}>{entry.tag}</span>
                  <span className="sdt-ov-release-text">{entry.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <a className="sdt-ov-all-releases" href="https://github.com/stack-auth/stack/releases" target="_blank" rel="noopener noreferrer">
            All releases
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
        </a>
      </div>
    </div>
  );
}

// END_PLATFORM
