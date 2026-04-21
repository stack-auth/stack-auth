"use client";

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Card, Input, Typography } from "@stackframe/stack-ui";
import { useState } from "react";

type MintResult = {
  id_token: string,
  issuer: string,
  sub: string,
  aud: string,
  expires_in: number,
};

type ExchangeOk = {
  ok: true,
  access_token: string,
  expires_in: number,
  token_type: string,
};

type ExchangeErr = {
  ok: false,
  status: number,
  error: string,
};

type ExchangeResult = ExchangeOk | ExchangeErr;

const DEFAULT_PROJECT_ID = "6fbbf22e-f4b2-4c6e-95a1-beab6fa41063";

export default function OidcFederationDemoPage() {
  const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
  const [sub, setSub] = useState("workload:demo-1");
  const [aud, setAud] = useState("stack-demo");
  const [minting, setMinting] = useState(false);
  const [exchanging, setExchanging] = useState(false);
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [exchangeResult, setExchangeResult] = useState<ExchangeResult | null>(null);

  const mint = async () => {
    setMinting(true);
    setMintResult(null);
    setExchangeResult(null);
    try {
      const res = await fetch("/oidc-federation-demo/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub, aud }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "mint failed");
      setMintResult(data);
    } finally {
      setMinting(false);
    }
  };

  const exchange = async () => {
    if (!mintResult) return;
    setExchanging(true);
    setExchangeResult(null);
    try {
      const res = await fetch("/oidc-federation-demo/api/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, subjectToken: mintResult.id_token }),
      });
      const data = await res.json();
      setExchangeResult(data);
    } finally {
      setExchanging(false);
    }
  };

  return (
    <div className="stack-scope min-h-screen flex items-start justify-center p-6 w-full">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div>
          <Typography type="h2" className="mb-1">OIDC Federation demo</Typography>
          <Typography variant="secondary">
            Step 1 mints a mock workload JWT from <code>apps/mock-oidc-idp</code>. Step 2 exchanges
            it at the backend for a short-lived Stack server access token via RFC 8693. The
            dummy project is pre-seeded with a trust policy accepting <code>workload:*</code> subs
            from this IdP with audience <code>stack-demo</code>.
          </Typography>
        </div>

        <Card className="p-5 flex flex-col gap-4">
          <Typography type="h4">1. Mint mock OIDC token</Typography>
          <LabelledInput label="Subject (sub)" value={sub} onChange={setSub} placeholder="workload:demo-1" />
          <LabelledInput label="Audience (aud)" value={aud} onChange={setAud} placeholder="stack-demo" />
          <Button
            onClick={() => runAsynchronouslyWithAlert(mint())}
            disabled={minting}
          >
            {minting ? "Minting…" : "Mint token"}
          </Button>
          {mintResult && (
            <KeyValue label="id_token">
              <pre className="text-xs overflow-x-auto p-2 bg-muted rounded whitespace-pre-wrap break-all">
                {mintResult.id_token}
              </pre>
              <Typography variant="secondary" className="text-xs">
                issuer <code>{mintResult.issuer}</code> · aud <code>{mintResult.aud}</code> · ttl {mintResult.expires_in}s
              </Typography>
            </KeyValue>
          )}
        </Card>

        <Card className="p-5 flex flex-col gap-4">
          <Typography type="h4">2. Exchange for Stack server access token</Typography>
          <LabelledInput label="Project ID" value={projectId} onChange={setProjectId} placeholder="project uuid" />
          <Button
            onClick={() => runAsynchronouslyWithAlert(exchange())}
            disabled={exchanging || !mintResult}
          >
            {exchanging ? "Exchanging…" : mintResult ? "Exchange token" : "Mint a token first"}
          </Button>
          {exchangeResult && (exchangeResult.ok ? (
            <div className="p-3 rounded bg-green-50 dark:bg-green-900/20 flex flex-col gap-2">
              <Typography className="text-green-700 dark:text-green-400 font-medium">
                Exchange OK — token expires in {exchangeResult.expires_in}s
              </Typography>
              <pre className="text-xs overflow-x-auto p-2 bg-green-100 dark:bg-green-900/40 rounded whitespace-pre-wrap break-all">
                {exchangeResult.access_token}
              </pre>
              <Typography variant="secondary" className="text-xs">
                Use this as <code>x-stack-server-access-token</code> on server-scope API calls — no
                <code> STACK_SECRET_SERVER_KEY</code> needed.
              </Typography>
            </div>
          ) : (
            <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 flex flex-col gap-1">
              <Typography className="text-red-700 dark:text-red-400 font-medium">
                Exchange failed ({exchangeResult.status})
              </Typography>
              <Typography variant="secondary" className="text-xs">{exchangeResult.error}</Typography>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function LabelledInput({ label, value, onChange, placeholder }: { label: string, value: string, onChange: (v: string) => void, placeholder?: string }) {
  return (
    <div>
      <Typography variant="secondary" className="text-xs mb-1 block">{label}</Typography>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function KeyValue({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div>
      <Typography variant="secondary" className="text-xs mb-1 block">{label}</Typography>
      {children}
    </div>
  );
}
