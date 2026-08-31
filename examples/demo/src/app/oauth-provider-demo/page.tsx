'use client';

import { useStackApp, useUser } from '@hexclave/next';
import { runAsynchronouslyWithAlert } from '@hexclave/shared/dist/utils/promises';
import { Button, Card, CardContent, CardHeader, Typography } from '@hexclave/ui';
import { useCallback, useState } from 'react';
import {
  BROWSER_FLOW_STORAGE_KEY,
  BrowserFlowState,
  DEMO_CLIENT_ID,
  DEMO_TEST_CASES,
  DEMO_TRUSTED_CLIENT_ID,
  getDemoCallbackUrl,
  getDemoResourceUri,
  getIssuerUrl,
  OAUTH_SCOPE,
} from './shared';

type RunResult = {
  ok: boolean,
  title: string,
  steps: { label: string, detail?: string }[],
  error?: string,
};

type BrowserVariant = {
  id: string,
  label: string,
  description: string,
  clientId: string,
  omitResource?: boolean,
  omitPkce?: boolean,
  plainChallenge?: boolean,
};

const BROWSER_VARIANTS: BrowserVariant[] = [
  { id: 'standard', label: 'Standard flow', description: 'PKCE S256, untrusted client — expect the hosted consent page, then token issuance on the callback.', clientId: DEMO_CLIENT_ID },
  { id: 'trusted', label: 'Trusted client', description: 'Skips the consent prompt (sign-in is still required) and lands straight on the callback.', clientId: DEMO_TRUSTED_CLIENT_ID },
  { id: 'no-resource', label: 'No resource param', description: 'Adversarial: omits resource=. The token exchange must fail with invalid_target.', clientId: DEMO_CLIENT_ID, omitResource: true },
  { id: 'no-pkce', label: 'No PKCE', description: 'Adversarial: omits code_challenge. Expect error=invalid_request on the callback.', clientId: DEMO_CLIENT_ID, omitPkce: true },
  { id: 'plain-pkce', label: 'PKCE method "plain"', description: 'Adversarial: code_challenge_method=plain. Expect an error on the callback.', clientId: DEMO_CLIENT_ID, plainChallenge: true },
];

function randomBase64Url(bytes: number): string {
  const array = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default function OAuthProviderDemoPage() {
  const app = useStackApp();
  const user = useUser();
  const [results, setResults] = useState<Map<string, RunResult | 'running'>>(new Map());
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const runTest = useCallback(async (testId: string) => {
    if (user == null) {
      log(`✗ ${testId}: sign in first — the consent decision needs your access token`);
      return;
    }
    setResults(prev => new Map(prev).set(testId, 'running'));
    log(`━━━ Running ${testId} ━━━`);
    const { accessToken } = await user.getAuthJson();
    const response = await fetch('/oauth-provider-demo/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ testId, accessToken }),
    });
    if (!response.ok) {
      const body = await response.json();
      setResults(prev => new Map(prev).set(testId, { ok: false, title: testId, steps: [], error: body.error ?? `HTTP ${response.status}` }));
      log(`✗ ${testId}: ${body.error ?? `HTTP ${response.status}`}`);
      return;
    }
    const result: RunResult = await response.json();
    setResults(prev => new Map(prev).set(testId, result));
    for (const step of result.steps) {
      log(`  ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
    }
    log(result.ok ? `✓ ${testId} passed` : `✗ ${testId} FAILED: ${result.error}`);
  }, [user, log]);

  const runAll = useCallback(async () => {
    for (const testCase of DEMO_TEST_CASES) {
      await runTest(testCase.id);
    }
  }, [runTest]);

  const startBrowserFlow = useCallback(async (variant: BrowserVariant) => {
    const codeVerifier = randomBase64Url(32);
    const state = randomBase64Url(16);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: variant.clientId,
      redirect_uri: getDemoCallbackUrl(),
      scope: OAUTH_SCOPE,
      prompt: 'consent',
      state,
    });
    if (variant.omitResource !== true) params.set('resource', getDemoResourceUri());
    if (variant.plainChallenge === true) {
      params.set('code_challenge', codeVerifier);
      params.set('code_challenge_method', 'plain');
    } else if (variant.omitPkce !== true) {
      params.set('code_challenge', await sha256Base64Url(codeVerifier));
      params.set('code_challenge_method', 'S256');
    }
    const flowState: BrowserFlowState = {
      codeVerifier,
      clientId: variant.clientId,
      ...(variant.omitResource === true ? {} : { resource: getDemoResourceUri() }),
      variant: variant.id,
      state,
    };
    sessionStorage.setItem(BROWSER_FLOW_STORAGE_KEY, JSON.stringify(flowState));
    window.location.assign(`${getIssuerUrl()}/auth?${params.toString()}`);
  }, []);

  const passed = [...results.values()].filter(result => result !== 'running' && result.ok).length;
  const failed = [...results.values()].filter(result => result !== 'running' && !result.ok).length;
  const anyRunning = [...results.values()].some(result => result === 'running');

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Typography type="h1" className="mb-2">OAuth Provider Test Suite</Typography>
      <Typography className="mb-6 text-gray-500 text-sm">
        This project acts as its own OAuth 2.1 / OIDC provider (the MCP auth flow). Issuer: <code className="text-xs">{getIssuerUrl()}</code>
      </Typography>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <span className="font-semibold">Browser user:</span>{' '}
          <span className={user == null ? 'text-gray-400' : 'text-green-600'}>
            {user == null ? 'Not signed in (headless tests need a user)' : user.primaryEmail ?? user.id}
          </span>
          {user == null && (
            <Button variant="secondary" className="ml-3" onClick={async () => { await app.redirectToSignIn(); }}>
              Sign In
            </Button>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <span className="font-semibold">Results:</span>{' '}
          <span className="text-green-600">{passed} passed</span>{', '}
          <span className={failed > 0 ? 'text-red-600' : 'text-gray-400'}>{failed} failed</span>{', '}
          <span className="text-gray-400">{DEMO_TEST_CASES.length - passed - failed} not run</span>
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <Typography type="h3">Headless protocol tests</Typography>
          <Button
            onClick={() => runAsynchronouslyWithAlert(runAll)}
            disabled={anyRunning || user == null}
          >
            Run All
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">Test</th>
                  <th className="py-2 pr-3">What it asserts</th>
                  <th className="py-2 pr-3 w-20">Status</th>
                  <th className="py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {DEMO_TEST_CASES.map((testCase) => {
                  const result = results.get(testCase.id);
                  return (
                    <tr key={testCase.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs font-bold">{testCase.title}</td>
                      <td className="py-2 pr-3 text-gray-600 text-xs">{testCase.description}</td>
                      <td className="py-2 pr-3 text-xs">
                        {result === undefined ? <span className="text-gray-400">—</span>
                          : result === 'running' ? <span className="text-yellow-600">running…</span>
                            : result.ok ? <span className="text-green-600 font-semibold">passed</span>
                              : <span className="text-red-600 font-semibold" title={result.error}>failed</span>}
                      </td>
                      <td className="py-2">
                        <Button
                          variant="secondary"
                          onClick={() => runAsynchronouslyWithAlert(() => runTest(testCase.id))}
                          disabled={anyRunning || user == null}
                        >
                          Run
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <Typography type="h3">Real browser flows</Typography>
          <Typography className="text-xs text-gray-500">
            These navigate away through the real authorize endpoint and hosted consent page, then land
            on the callback page with the result. Sign-in state matters: repeat them signed in, in a
            fresh incognito window, and signed out after a previous success — the three states behave
            differently.
          </Typography>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {BROWSER_VARIANTS.map((variant) => (
              <div key={variant.id} className="flex items-center gap-3 border-b last:border-0 pb-2 last:pb-0">
                <Button
                  variant="secondary"
                  className="shrink-0 w-44"
                  onClick={() => runAsynchronouslyWithAlert(() => startBrowserFlow(variant))}
                >
                  {variant.label}
                </Button>
                <Typography className="text-xs text-gray-600">{variant.description}</Typography>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <Typography type="h3">Console Log</Typography>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-900 text-green-400 font-mono text-xs p-4 rounded-lg max-h-80 overflow-y-auto">
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
