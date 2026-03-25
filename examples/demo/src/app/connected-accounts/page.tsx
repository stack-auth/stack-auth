'use client';

import { OAuthConnection, useUser } from "@stackframe/stack";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

function ConnectedAccountCard({ account }: { account: OAuthConnection }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccessToken = async () => {
    setLoading(true);
    setError(null);
    const result = await account.getAccessToken();
    if (result.status === "ok") {
      setAccessToken(result.data.accessToken);
    } else {
      setError(result.error.humanReadableMessage);
    }
    setLoading(false);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg">{account.provider}</CardTitle>
        <CardDescription>Account ID: {account.providerAccountId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm space-y-1">
          <p><strong>Provider:</strong> <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{account.provider}</code></p>
          <p><strong>Account ID:</strong> <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">{account.providerAccountId}</code></p>
          <p className="text-gray-500"><strong>Deprecated ID:</strong> <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{account.id}</code> (same as provider for backwards compat)</p>
        </div>

        <div className="pt-2">
          <Button onClick={fetchAccessToken} loading={loading} size="sm">
            Get Access Token
          </Button>
        </div>

        {accessToken && (
          <div className="mt-2">
            <Typography variant="secondary" type="label">Access Token:</Typography>
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto mt-1">
              {accessToken.substring(0, 50)}...
            </pre>
          </div>
        )}

        {error && (
          <div className="text-red-500 text-sm mt-2">
            Error: {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectedAccountsList() {
  const user = useUser({ or: 'redirect' });
  const connectedAccounts = user.useConnectedAccounts();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Typography variant="secondary" type="label">
          Found {connectedAccounts.length} connected account(s)
        </Typography>
      </div>

      {connectedAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            No connected accounts yet. Link an OAuth provider below.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {connectedAccounts.map((account) => (
            <ConnectedAccountCard
              key={`${account.provider}-${account.providerAccountId}`}
              account={account}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GetConnectedAccountDemo() {
  const user = useUser({ or: 'redirect' });
  const [provider, setProvider] = useState("spotify");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGetByProvider = async () => {
    setLoading(true);
    try {
      const account = await user.getConnectedAccount(provider as any);
      if (account) {
        setResult(JSON.stringify({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          id: account.id,
        }, null, 2));
      } else {
        setResult("null (no account found)");
      }
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGetByBothIds = async () => {
    setLoading(true);
    try {
      const account = await user.getConnectedAccount({
        provider,
        providerAccountId,
      });
      if (account) {
        setResult(JSON.stringify({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          id: account.id,
        }, null, 2));
      } else {
        setResult("null (no account found)");
      }
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get Connected Account</CardTitle>
        <CardDescription>
          Look up a specific connected account by provider or by both provider and account ID
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Provider</label>
          <input
            type="text"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., spotify, google, github"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Provider Account ID (optional)</label>
          <input
            type="text"
            value={providerAccountId}
            onChange={(e) => setProviderAccountId(e.target.value)}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., user123, email@example.com"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleGetByProvider} loading={loading} variant="secondary">
            Get by Provider Only
          </Button>
          <Button onClick={handleGetByBothIds} loading={loading} disabled={!providerAccountId}>
            Get by Provider + Account ID
          </Button>
        </div>

        {result && (
          <div className="mt-4">
            <Typography variant="secondary" type="label">Result:</Typography>
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto mt-1">
              {result}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkNewAccountDemo() {
  const user = useUser({ or: 'redirect' });
  const [provider, setProvider] = useState("spotify");
  const [scopes, setScopes] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLink = async () => {
    setLoading(true);
    try {
      await user.linkConnectedAccount(provider, {
        scopes: scopes ? scopes.split(",").map(s => s.trim()) : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link New Connected Account</CardTitle>
        <CardDescription>
          Link a new OAuth provider account. You can link multiple accounts from the same provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
          >
            <option value="spotify">Spotify</option>
            <option value="google">Google</option>
            <option value="github">GitHub</option>
            <option value="facebook">Facebook</option>
            <option value="microsoft">Microsoft</option>
            <option value="discord">Discord</option>
            <option value="twitter">Twitter/X</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Scopes (comma-separated, optional)</label>
          <input
            type="text"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700"
            placeholder="e.g., playlist-read-private, user-library-read"
          />
        </div>

        <Button onClick={handleLink} loading={loading}>
          Link {provider} Account
        </Button>

        <p className="text-sm text-gray-500">
          This will redirect you to the OAuth provider to authorize the connection.
          After authorizing, you&apos;ll be redirected back here.
        </p>
      </CardContent>
    </Card>
  );
}

function LegacyGetConnectedAccountDemo() {
  const user = useUser({ or: 'redirect' });

  // Using the legacy hook pattern
  const spotifyConnection = user.useConnectedAccount('spotify');
  const googleConnection = user.useConnectedAccount('google');
  const githubConnection = user.useConnectedAccount('github');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legacy useConnectedAccount Hook</CardTitle>
        <CardDescription>
          Using the original hook pattern (by provider only). Returns the first account for each provider.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${spotifyConnection ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span>Spotify: {spotifyConnection ? `Connected (${spotifyConnection.providerAccountId})` : 'Not connected'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${googleConnection ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span>Google: {googleConnection ? `Connected (${googleConnection.providerAccountId})` : 'Not connected'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${githubConnection ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span>GitHub: {githubConnection ? `Connected (${githubConnection.providerAccountId})` : 'Not connected'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ConnectedAccountsPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Connected Accounts Demo</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Demonstrates the connected accounts API for linking and managing OAuth provider connections.
            Users can now have multiple accounts from the same provider (e.g., multiple Google accounts).
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">All Connected Accounts</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Uses <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">user.useConnectedAccounts()</code> to list all connected accounts.
          </p>
          <ConnectedAccountsList />
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Link a New Account</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Uses <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">user.linkConnectedAccount(provider)</code> to initiate the OAuth flow.
          </p>
          <LinkNewAccountDemo />
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Get Specific Account</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Uses <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">user.getConnectedAccount()</code> with either just provider (backward compatible) or with both provider and account ID (new).
          </p>
          <GetConnectedAccountDemo />
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Legacy Hook Pattern</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            The original <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">user.useConnectedAccount(provider)</code> still works for backward compatibility.
          </p>
          <LegacyGetConnectedAccountDemo />
        </section>

        <section className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
          <h3 className="font-semibold mb-2">API Summary</h3>
          <ul className="text-sm space-y-2 text-gray-600 dark:text-gray-400">
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">listConnectedAccounts()</code> - List all connected accounts</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">useConnectedAccounts()</code> - React hook for listing all connected accounts</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">linkConnectedAccount(provider, options?)</code> - Link a new OAuth account (redirect)</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">getOrLinkConnectedAccount(provider, options?)</code> - Get existing or redirect to link</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">useOrLinkConnectedAccount(provider, options?)</code> - React hook for get-or-link</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"getConnectedAccount({ provider, providerAccountId })"}</code> - Get specific account (existence check)</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"connection.getAccessToken({ scopes? })"}</code> - Get OAuth access token (returns Result)</li>
            <li><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{"connection.useAccessToken({ scopes? })"}</code> - React hook for access token (returns Result)</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
