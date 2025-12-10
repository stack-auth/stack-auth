"use client";

import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

// Decode JWT without verification (for display purposes only)
function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

// Format timestamp fields as readable dates
function formatPayload(payload: Record<string, any>): Record<string, any> {
  const formatted: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if ((key === 'iat' || key === 'exp' || key === 'nbf') && typeof value === 'number') {
      const date = new Date(value * 1000);
      formatted[key] = `${value} (${date.toLocaleString()})`;
    } else if (typeof value === 'object' && value !== null) {
      formatted[key] = formatPayload(value);
    } else {
      formatted[key] = value;
    }
  }
  return formatted;
}

function AccessTokenViewer({ token }: { token: string | null | undefined }) {
  if (!token) return null;

  const payload = decodeJwt(token);
  if (!payload) return null;

  const formatted = formatPayload(payload);

  return (
    <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
      <Typography variant="secondary" className="text-xs font-medium mb-1 text-blue-600 dark:text-blue-400">
        🔍 Decoded JWT Payload
      </Typography>
      <pre className="text-xs overflow-auto text-blue-700 dark:text-blue-300 font-mono whitespace-pre-wrap">
        {JSON.stringify(formatted, null, 2)}
      </pre>
    </div>
  );
}

function TokenDisplay({ label, value, isLoading, showDecoded }: { label: string, value: string | null | undefined, isLoading?: boolean, showDecoded?: boolean }) {
  const truncated = value && value.length > 80 ? `${value.slice(0, 40)}...${value.slice(-40)}` : value;
  return (
    <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <Typography variant="secondary" className="text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">
        {label}
      </Typography>
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : value ? (
        <>
          <code className="text-xs break-all text-green-600 dark:text-green-400 font-mono">{truncated}</code>
          {showDecoded && <AccessTokenViewer token={value} />}
        </>
      ) : (
        <span className="text-sm text-gray-400 italic">null</span>
      )}
    </div>
  );
}

function JsonDisplay({ label, value, isLoading, accessTokenKey }: { label: string, value: any, isLoading?: boolean, accessTokenKey?: string }) {
  const accessToken = accessTokenKey && value ? value[accessTokenKey] : null;
  return (
    <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <Typography variant="secondary" className="text-xs font-medium mb-1 text-gray-500 dark:text-gray-400">
        {label}
      </Typography>
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : value ? (
        <>
          <pre className="text-xs overflow-auto text-green-600 dark:text-green-400 font-mono">
            {JSON.stringify(value, null, 2)}
          </pre>
          {accessToken && <AccessTokenViewer token={accessToken} />}
        </>
      ) : (
        <span className="text-sm text-gray-400 italic">null</span>
      )}
    </div>
  );
}

function HookBasedTokens() {
  const user = useUser();
  const app = useStackApp();

  if (!user) {
    return (
      <Card className="p-4">
        <Typography variant="secondary" className="text-center text-gray-500">
          Sign in to see hook-based token values
        </Typography>
      </Card>
    );
  }

  // Using the hook variants
  const accessToken = (user as any).useAccessToken?.() ?? null;
  const refreshToken = (user as any).useRefreshToken?.() ?? null;
  const authHeaders = (user as any).useAuthHeaders?.() ?? null;
  const authJson = (user as any).useAuthJson?.() ?? null;
  const sessionTokens = user.currentSession.useTokens();

  // App-level hooks
  const appAccessToken = (app as any).useAccessToken?.() ?? null;
  const appRefreshToken = (app as any).useRefreshToken?.() ?? null;
  const appAuthHeaders = (app as any).useAuthHeaders?.() ?? null;
  const appAuthJson = (app as any).useAuthJson?.() ?? null;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <Typography variant="primary" className="mb-4 text-lg font-semibold">
          🪝 Hook-based Methods (user.use*)
        </Typography>
        <Typography variant="secondary" className="mb-4 text-sm text-gray-500">
          These hooks provide reactive access to tokens and re-render when tokens change.
        </Typography>

        <TokenDisplay label="user.useAccessToken()" value={accessToken} showDecoded />
        <TokenDisplay label="user.useRefreshToken()" value={refreshToken} />
        <JsonDisplay label="user.useAuthHeaders()" value={authHeaders} />
        <JsonDisplay label="user.useAuthJson() [deprecated]" value={authJson} accessTokenKey="accessToken" />
        <JsonDisplay label="user.currentSession.useTokens()" value={sessionTokens} accessTokenKey="accessToken" />
      </Card>

      <Card className="p-4">
        <Typography variant="primary" className="mb-4 text-lg font-semibold">
          🪝 Hook-based Methods (app.use*)
        </Typography>
        <Typography variant="secondary" className="mb-4 text-sm text-gray-500">
          App-level hooks work the same but don&apos;t require having a user object first.
        </Typography>

        <TokenDisplay label="app.useAccessToken()" value={appAccessToken} showDecoded />
        <TokenDisplay label="app.useRefreshToken()" value={appRefreshToken} />
        <JsonDisplay label="app.useAuthHeaders()" value={appAuthHeaders} />
        <JsonDisplay label="app.useAuthJson() [deprecated]" value={appAuthJson} accessTokenKey="accessToken" />
      </Card>
    </div>
  );
}

function AsyncBasedTokens() {
  const user = useUser();
  const app = useStackApp();

  const [isLoading, setIsLoading] = useState(false);
  const [asyncResults, setAsyncResults] = useState<{
    userAccessToken?: string | null,
    userRefreshToken?: string | null,
    userAuthHeaders?: { "x-stack-auth": string } | null,
    userAuthJson?: { accessToken: string | null, refreshToken: string | null } | null,
    sessionTokens?: { accessToken: string | null, refreshToken: string | null } | null,
    appAccessToken?: string | null,
    appRefreshToken?: string | null,
    appAuthHeaders?: { "x-stack-auth": string } | null,
    appAuthJson?: { accessToken: string | null, refreshToken: string | null } | null,
  } | null>(null);

  const fetchAsyncTokens = async () => {
    setIsLoading(true);
    try {
      const results: typeof asyncResults = {};

      if (user) {
        results.userAccessToken = await (user as any).getAccessToken?.();
        results.userRefreshToken = await (user as any).getRefreshToken?.();
        results.userAuthHeaders = await user.getAuthHeaders();
        results.userAuthJson = await user.getAuthJson();
        results.sessionTokens = await user.currentSession.getTokens();
      }

      results.appAccessToken = await (app as any).getAccessToken?.();
      results.appRefreshToken = await (app as any).getRefreshToken?.();
      results.appAuthHeaders = await app.getAuthHeaders();
      results.appAuthJson = await app.getAuthJson();

      setAsyncResults(results);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <Typography variant="primary" className="mb-4 text-lg font-semibold">
          ⏳ Async Methods (user.get*)
        </Typography>
        <Typography variant="secondary" className="mb-4 text-sm text-gray-500">
          These async methods fetch tokens on demand. Click the button to fetch current values.
        </Typography>

        <Button
          onClick={() => runAsynchronouslyWithAlert(fetchAsyncTokens())}
          disabled={isLoading}
          className="mb-4"
        >
          {isLoading ? "Fetching..." : "Fetch Async Tokens"}
        </Button>

        {!user && (
          <Typography variant="secondary" className="text-center text-gray-500 mb-4">
            Sign in to see user-level async token values
          </Typography>
        )}

        {user && (
          <>
            <TokenDisplay label="await user.getAccessToken()" value={asyncResults?.userAccessToken} isLoading={isLoading && !asyncResults} showDecoded />
            <TokenDisplay label="await user.getRefreshToken()" value={asyncResults?.userRefreshToken} isLoading={isLoading && !asyncResults} />
            <JsonDisplay label="await user.getAuthHeaders()" value={asyncResults?.userAuthHeaders} isLoading={isLoading && !asyncResults} />
            <JsonDisplay label="await user.getAuthJson() [deprecated]" value={asyncResults?.userAuthJson} isLoading={isLoading && !asyncResults} accessTokenKey="accessToken" />
            <JsonDisplay label="await user.currentSession.getTokens()" value={asyncResults?.sessionTokens} isLoading={isLoading && !asyncResults} accessTokenKey="accessToken" />
          </>
        )}
      </Card>

      <Card className="p-4">
        <Typography variant="primary" className="mb-4 text-lg font-semibold">
          ⏳ Async Methods (app.get*)
        </Typography>
        <Typography variant="secondary" className="mb-4 text-sm text-gray-500">
          App-level async methods work even without getting a user object first.
        </Typography>

        <TokenDisplay label="await app.getAccessToken()" value={asyncResults?.appAccessToken} isLoading={isLoading && !asyncResults} showDecoded />
        <TokenDisplay label="await app.getRefreshToken()" value={asyncResults?.appRefreshToken} isLoading={isLoading && !asyncResults} />
        <JsonDisplay label="await app.getAuthHeaders()" value={asyncResults?.appAuthHeaders} isLoading={isLoading && !asyncResults} />
        <JsonDisplay label="await app.getAuthJson() [deprecated]" value={asyncResults?.appAuthJson} isLoading={isLoading && !asyncResults} accessTokenKey="accessToken" />
      </Card>
    </div>
  );
}

export default function TokensDemoPage() {
  const user = useUser();

  return (
    <div className="stack-scope min-h-screen flex items-center justify-center p-4 md:p-8">
      <div className="max-w-5xl w-full">
        <div className="mb-8 text-center">
          <Typography variant="primary" className="text-2xl font-bold mb-2">
            🔑 Token Functions Demo
          </Typography>
          <Typography variant="secondary" className="text-gray-500">
            This page demonstrates all the token-related functions available in Stack Auth.
          </Typography>
          {!user && (
            <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg inline-block">
              <Typography variant="secondary" className="text-yellow-700 dark:text-yellow-400">
                ⚠️ Sign in to see token values. Currently not authenticated.
              </Typography>
            </div>
          )}
          {user && (
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg inline-block">
              <Typography variant="secondary" className="text-green-700 dark:text-green-400">
                ✅ Signed in as {user.primaryEmail || user.displayName || user.id}
              </Typography>
            </div>
          )}
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <Typography variant="primary" className="text-xl font-semibold mb-4 text-center">
              React Hooks (Synchronous)
            </Typography>
            <HookBasedTokens />
          </div>

          <div>
            <Typography variant="primary" className="text-xl font-semibold mb-4 text-center">
              Async Functions
            </Typography>
            <AsyncBasedTokens />
          </div>
        </div>

        <Card className="mt-8 p-4">
          <Typography variant="primary" className="text-lg font-semibold mb-4">
            📚 Usage Notes
          </Typography>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
            <p>
              <strong>useAccessToken() / getAccessToken():</strong> Returns the short-lived JWT access token used for API authentication.
            </p>
            <p>
              <strong>useRefreshToken() / getRefreshToken():</strong> Returns the long-lived refresh token used to obtain new access tokens.
            </p>
            <p>
              <strong>useAuthHeaders() / getAuthHeaders():</strong> Returns headers ready to use with fetch() for cross-origin authenticated requests.
            </p>
            <p>
              <strong className="text-yellow-600">useAuthJson() / getAuthJson() [deprecated]:</strong> Returns both tokens as JSON. Use individual token getters instead.
            </p>
            <p>
              <strong>currentSession.useTokens() / getTokens():</strong> Returns both tokens from the current session object.
            </p>
          </div>
        </Card>

        <Card className="mt-4 p-4">
          <Typography variant="primary" className="text-lg font-semibold mb-4">
            🔍 JWT Payload Fields
          </Typography>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
            <p><strong>iat</strong> (Issued At): When the token was created</p>
            <p><strong>exp</strong> (Expiration): When the token expires</p>
            <p><strong>sub</strong> (Subject): The user ID</p>
            <p><strong>iss</strong> (Issuer): The token issuer (Stack Auth)</p>
            <p><strong>aud</strong> (Audience): The intended recipient (your project ID)</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
