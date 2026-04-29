'use client';

import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, CardContent, CardHeader, Input, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

export default function SamlDemoPage() {
  const app = useStackApp() as ReturnType<typeof useStackApp> & {
    signInWithSaml: (options: { connectionId: string, returnTo?: string }) => Promise<void>,
    signInWithSso: (options: { email: string, returnTo?: string }) => Promise<void>,
    getSamlConnectionForEmail: (email: string) => Promise<{ connectionId: string, displayName: string } | null>,
  };
  const user = useUser();
  const [email, setEmail] = useState("");
  const [discoveryResult, setDiscoveryResult] = useState<{ connectionId: string, displayName: string } | null | "error" | undefined>(undefined);

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <Typography type="h1" className="mb-2">SAML SSO Demo</Typography>
      <Typography className="mb-6 text-gray-600">
        Manual end-to-end check for the SAML round-trip against the local mock IdP. Seed the dummy
        project with <code>STACK_SEED_ENABLE_SAML=true</code> first; that pre-creates two
        connections (acme + globex) pointing at <code>localhost:8115</code>.
      </Typography>

      <div className="grid gap-6">
        <Card>
          <CardHeader><Typography type="h3">Current state</Typography></CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div><span className="font-semibold">Signed in:</span> {user ? "yes" : "no"}</div>
              {user && (
                <>
                  <div><span className="font-semibold">User ID:</span> <code>{user.id}</code></div>
                  <div><span className="font-semibold">Email:</span> <code>{user.primaryEmail ?? "(none)"}</code></div>
                  <div><span className="font-semibold">Display name:</span> <code>{user.displayName ?? "(none)"}</code></div>
                </>
              )}
            </div>
            {user && (
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await user.signOut({ redirectUrl: "/saml-demo" });
                })}
              >
                Sign out
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Typography type="h3">1. Sign in by email-domain discovery</Typography></CardHeader>
          <CardContent>
            <Typography className="mb-2 text-sm text-gray-600">
              Enter <code>alice@acme.test</code> or <code>bob@globex.test</code>. The SDK looks up
              the matching SAML connection via <code>/auth/saml/discover</code>, then redirects.
            </Typography>
            <div className="flex gap-2 items-center mb-2">
              <Input
                type="email"
                placeholder="alice@acme.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  setDiscoveryResult(undefined);
                  try {
                    const result = await app.getSamlConnectionForEmail(email);
                    setDiscoveryResult(result);
                  } catch (e) {
                    setDiscoveryResult("error");
                  }
                })}
              >
                Preview connection
              </Button>
              <Button
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithSso({ email, returnTo: "/saml-demo" });
                })}
              >
                Sign in via SSO
              </Button>
            </div>
            {discoveryResult === "error" && (
              <Typography className="text-sm text-red-600">No SAML connection matches this domain.</Typography>
            )}
            {discoveryResult && discoveryResult !== "error" && (
              <Typography className="text-sm">
                Matched: <code>{discoveryResult.connectionId}</code> ({discoveryResult.displayName})
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Typography type="h3">2. Sign in by direct connection ID</Typography></CardHeader>
          <CardContent>
            <Typography className="mb-2 text-sm text-gray-600">
              For when the customer&apos;s UI has explicit per-tenant buttons rather than a unified
              email field.
            </Typography>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithSaml({ connectionId: "acme", returnTo: "/saml-demo" });
                })}
              >
                Sign in with Acme SSO
              </Button>
              <Button
                variant="outline"
                onClick={() => runAsynchronouslyWithAlert(async () => {
                  await app.signInWithSaml({ connectionId: "globex", returnTo: "/saml-demo" });
                })}
              >
                Sign in with Globex SAML
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><Typography type="h3">SDK snippet</Typography></CardHeader>
          <CardContent>
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded overflow-x-auto">{`// Email-domain discovery (preferred for unified login forms)
await app.signInWithSso({ email: "alice@acme.test", returnTo: "/" });

// Direct connection ID (when you render per-tenant buttons)
await app.signInWithSaml({ connectionId: "acme", returnTo: "/" });

// Just preview the matching connection without redirecting:
const conn = await app.getSamlConnectionForEmail("alice@acme.test");
// → { connectionId: "acme", displayName: "Acme Corp SSO" }`}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
