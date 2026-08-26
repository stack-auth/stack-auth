'use client';

import { runAsynchronouslyWithAlert } from '@hexclave/shared/dist/utils/promises';
import { Button, Card, CardContent, CardHeader, Typography } from '@hexclave/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BROWSER_FLOW_STORAGE_KEY, BrowserFlowState } from '../shared';

type ExchangeResult = {
  step?: string,
  error?: unknown,
  tokenResponse?: Record<string, unknown>,
  accessToken?: string,
  claims?: Record<string, unknown>,
  verification?: { ok: boolean, reason?: string, message?: string },
  user?: { id: string, displayName: string | null, primaryEmail: string | null } | null,
};

type CallbackState =
  | { kind: 'loading' }
  | { kind: 'oauth-error', error: string, description: string | null, variant: string | null }
  | { kind: 'missing-state', message: string }
  | { kind: 'exchanged', variant: string | null, result: ExchangeResult };

export default function OAuthProviderDemoCallbackPage() {
  const [state, setState] = useState<CallbackState>({ kind: 'loading' });
  const [resourceCall, setResourceCall] = useState<{ status: number, body: unknown } | null>(null);

  useEffect(() => {
    // Read window.location in an effect (instead of useSearchParams) so the page stays statically
    // prerenderable without a Suspense boundary.
    const params = new URLSearchParams(window.location.search);
    const storedRaw = sessionStorage.getItem(BROWSER_FLOW_STORAGE_KEY);
    const stored: BrowserFlowState | null = storedRaw === null ? null : JSON.parse(storedRaw);

    const error = params.get('error');
    if (error !== null) {
      setState({ kind: 'oauth-error', error, description: params.get('error_description'), variant: stored?.variant ?? null });
      return;
    }
    const code = params.get('code');
    if (code === null) {
      setState({ kind: 'missing-state', message: 'No code or error in the callback URL. Start a flow from the demo page.' });
      return;
    }
    if (stored === null) {
      setState({ kind: 'missing-state', message: 'Got a code but no stored PKCE verifier (sessionStorage is per-tab). Start the flow from the demo page in this tab.' });
      return;
    }
    if (params.get('state') !== stored.state) {
      setState({ kind: 'missing-state', message: 'The state parameter does not match the stored value — refusing to exchange the code.' });
      return;
    }
    sessionStorage.removeItem(BROWSER_FLOW_STORAGE_KEY);
    runAsynchronouslyWithAlert(async () => {
      const response = await fetch('/oauth-provider-demo/api/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: stored.codeVerifier,
          clientId: stored.clientId,
          ...(stored.resource === undefined ? {} : { resource: stored.resource }),
        }),
      });
      if (!response.ok) throw new Error(`Exchange endpoint answered ${response.status}`);
      setState({ kind: 'exchanged', variant: stored.variant, result: await response.json() });
    });
  }, []);

  const callResource = async (accessToken: string | undefined) => {
    const response = await fetch('/oauth-provider-demo/api/mcp', {
      headers: accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` },
    });
    setResourceCall({ status: response.status, body: await response.json() });
  };

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <Typography type="h1" className="mb-2">OAuth Callback</Typography>
      <Typography className="mb-6 text-gray-500 text-sm">
        <Link href="/oauth-provider-demo" className="underline">← Back to the test suite</Link>
      </Typography>

      {state.kind === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
          Exchanging the authorization code…
        </div>
      )}

      {state.kind === 'oauth-error' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <Typography className="font-semibold text-yellow-800 mb-1">
            Provider returned an error{state.variant ? ` (variant: ${state.variant})` : ''}
          </Typography>
          <Typography className="text-sm text-yellow-800">
            <code>{state.error}</code>{state.description ? ` — ${state.description}` : ''}
          </Typography>
          <Typography className="text-xs text-yellow-700 mt-2">
            For the adversarial variants (no PKCE, plain challenge method), this error is the expected, passing outcome.
          </Typography>
        </div>
      )}

      {state.kind === 'missing-state' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <Typography className="text-red-800">{state.message}</Typography>
        </div>
      )}

      {state.kind === 'exchanged' && state.result.error !== undefined && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <Typography className="font-semibold text-yellow-800 mb-1">
            Token exchange failed at step: {state.result.step}{state.variant ? ` (variant: ${state.variant})` : ''}
          </Typography>
          <pre className="text-xs overflow-auto bg-white p-2 rounded border">{JSON.stringify(state.result.error, null, 2)}</pre>
          <Typography className="text-xs text-yellow-700 mt-2">
            For the “no resource param” variant, <code>invalid_target</code> here is the expected, passing outcome.
          </Typography>
        </div>
      )}

      {state.kind === 'exchanged' && state.result.error === undefined && (
        <div className="space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <Typography className="font-semibold text-green-800">
              Token issued{state.variant ? ` (variant: ${state.variant})` : ''} — verifier says:{' '}
              {state.result.verification?.ok
                ? 'valid'
                : `rejected (${state.result.verification?.reason}: ${state.result.verification?.message})`}
            </Typography>
          </div>

          <Card>
            <CardHeader><Typography type="h3">Token response</Typography></CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto">{JSON.stringify(state.result.tokenResponse, null, 2)}</pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><Typography type="h3">Decoded access-token claims</Typography></CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto">{JSON.stringify(state.result.claims, null, 2)}</pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><Typography type="h3">User resolved via getUser({'{ from: "mcp" }'})</Typography></CardHeader>
            <CardContent>
              <pre className="text-xs overflow-auto">{JSON.stringify(state.result.user, null, 2)}</pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Typography type="h3">Resource server call</Typography>
              <Typography className="text-xs text-gray-500">
                Fires the token at the demo&apos;s bearer-protected endpoint (<code>/oauth-provider-demo/api/mcp</code>),
                the way an MCP client would call an MCP server.
              </Typography>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-3">
                <Button onClick={() => runAsynchronouslyWithAlert(() => callResource(state.result.accessToken))}>
                  Call with token
                </Button>
                <Button variant="secondary" onClick={() => runAsynchronouslyWithAlert(() => callResource(undefined))}>
                  Call without token (expect 401)
                </Button>
              </div>
              {resourceCall !== null && (
                <pre className="text-xs overflow-auto bg-gray-50 p-2 rounded border">
                  HTTP {resourceCall.status}{'\n'}{JSON.stringify(resourceCall.body, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
