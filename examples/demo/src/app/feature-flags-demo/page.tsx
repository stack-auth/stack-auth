"use client";

import { useStackApp, useUser } from "@stackframe/stack";
import { Button, Card, CardContent, CardHeader, Typography } from "@stackframe/stack-ui";
import { useCallback, useEffect, useState } from "react";

type EvalResult = {
  flag_key: string,
  variant_key: string | null,
  value: unknown,
  reason: string,
  rule_id: string | null,
};

const apiUrl = process.env.NEXT_PUBLIC_STACK_API_URL;
const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
const publishableClientKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

async function evaluateFlags(body: Record<string, unknown>): Promise<Record<string, EvalResult>> {
  const res = await fetch(`${apiUrl}/api/latest/feature-flags/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stack-access-type": "client",
      "x-stack-project-id": projectId ?? "",
      "x-stack-publishable-client-key": publishableClientKey ?? "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`evaluate failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.results;
}

export default function Page() {
  // The demo seeds three flags (`new-checkout`, `pricing-experiment`, `internal-tools`); we render
  // whichever ones come back. This page is intentionally tiny — it shows the *integration shape*
  // that future SDKs (`useFeatureFlag`, the Vercel adapter) will wrap.
  useStackApp(); // hook order — keeps React happy across auth states
  const user = useUser();

  const [results, setResults] = useState<Record<string, EvalResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [distinctId, setDistinctId] = useState("demo-user");

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const r = await evaluateFlags({
        distinct_id: user?.id ?? distinctId,
        user_id: user?.id,
        user: user?.primaryEmail ? { email: user.primaryEmail } : undefined,
        flag_keys: ["new-checkout", "pricing-experiment", "internal-tools"],
      });
      setResults(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user?.id, user?.primaryEmail, distinctId]);

  useEffect(() => {
    refetch().catch(() => { /* error already surfaced via state */ });
  }, [refetch]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl mx-auto">
      <Typography type="h2">Feature Flags Demo</Typography>
      <Typography variant="secondary">
        Calls <code>/api/latest/feature-flags/evaluate</code> with the publishable client key. The
        seeded project ships three demo flags: <code>new-checkout</code> (25% rollout),
        <code>pricing-experiment</code> (50/25/25 multivariate), and <code>internal-tools</code>
        (gated to <code>@stack-auth.com</code> emails).
      </Typography>

      {!user && (
        <Card>
          <CardContent className="pt-6">
            <Typography>
              Not signed in — using anonymous distinct id <code>{distinctId}</code>. Try a few
              different ids to see flag bucketing change deterministically.
            </Typography>
            <div className="flex gap-2 mt-3">
              <input
                className="flex-1 border rounded px-2 py-1 text-sm"
                value={distinctId}
                onChange={(e) => setDistinctId(e.target.value)}
              />
              <Button onClick={() => void refetch()}>Re-evaluate</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <Typography className="text-red-600">{error}</Typography>
          </CardContent>
        </Card>
      )}

      {results && Object.entries(results).map(([key, r]) => (
        <Card key={key}>
          <CardHeader>
            <Typography type="h4">{key}</Typography>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <div><span className="font-mono text-muted-foreground">value: </span><code>{JSON.stringify(r.value)}</code></div>
            <div><span className="font-mono text-muted-foreground">variant: </span><code>{r.variant_key ?? "—"}</code></div>
            <div><span className="font-mono text-muted-foreground">reason: </span><code>{r.reason}</code></div>
            {r.rule_id && <div><span className="font-mono text-muted-foreground">rule: </span><code>{r.rule_id}</code></div>}
          </CardContent>
        </Card>
      ))}

      {results && Object.keys(results).length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <Typography>
              No flags returned — has the project been seeded? The dev launchpad seeds three demo
              flags into the internal project on first run.
            </Typography>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
