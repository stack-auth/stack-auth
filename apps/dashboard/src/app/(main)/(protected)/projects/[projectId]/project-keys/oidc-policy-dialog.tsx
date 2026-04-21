"use client";

import { DesignAlert, DesignButton, DesignInput, DesignPillToggle } from "@/components/design-components";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Label, Textarea, Typography } from "@/components/ui";
import type { StackAdminApp } from "@stackframe/stack";
import { ClockIcon, GlobeHemisphereWestIcon, LinkSimpleIcon, PlusIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  DiscoveryProbeResult,
  DraftValidationIssue,
  PolicyDraft,
  draftToPolicy,
  emptyDraft,
  newAudienceRow,
  parseClaimConditionsJson,
  validateDraft,
  type TrustPolicy,
} from "./oidc-policy-form";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";

type Preset = {
  id: string,
  label: string,
  description: string,
  seed: () => Pick<PolicyDraft, "displayName" | "issuerUrl" | "audiences" | "claimConditionsJson">,
  exampleSnippet: (projectId: string) => string,
};

const stringifyClaims = (v: { stringEquals?: Record<string, string[]>, stringLike?: Record<string, string[]> }) =>
  JSON.stringify({ stringEquals: v.stringEquals ?? {}, stringLike: v.stringLike ?? {} }, null, 2);

const PRESETS: Preset[] = [
  {
    id: "vercel",
    label: "Vercel",
    description: "Team-scoped issuer like https://oidc.vercel.com/<team>",
    seed: () => ({
      displayName: "Vercel production",
      issuerUrl: "https://oidc.vercel.com/YOUR_TEAM_SLUG",
      audiences: [newAudienceRow("https://vercel.com/YOUR_TEAM_SLUG")],
      claimConditionsJson: stringifyClaims({
        stringEquals: { environment: ["production"] },
        stringLike: { sub: ["owner:YOUR_TEAM_SLUG:project:*:environment:production"] },
      }),
    }),
    exampleSnippet: (projectId) => `import { StackServerApp, fromVercelOidc } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  projectId: "${projectId}",
  tokenStore: "nextjs-cookie",
  auth: { oidcFederation: fromVercelOidc() },
});
`,
  },
  {
    id: "github-actions",
    label: "GitHub Actions",
    description: "Per-repo subject matching against token.actions.githubusercontent.com",
    seed: () => ({
      displayName: "GitHub Actions",
      issuerUrl: "https://token.actions.githubusercontent.com",
      audiences: [newAudienceRow("https://github.com/YOUR_ORG")],
      claimConditionsJson: stringifyClaims({
        stringLike: { sub: ["repo:YOUR_ORG/YOUR_REPO:*"] },
      }),
    }),
    exampleSnippet: (projectId) => `import { StackServerApp, fromGithubActionsOidc } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  projectId: "${projectId}",
  tokenStore: "memory",
  auth: { oidcFederation: fromGithubActionsOidc({ audience: "https://github.com/YOUR_ORG" }) },
});
`,
  },
  {
    id: "gcp",
    label: "GCP",
    description: "Trust Google-signed identity tokens issued to a GCP workload",
    seed: () => ({
      displayName: "GCP workload",
      issuerUrl: "https://accounts.google.com",
      audiences: [newAudienceRow("stack-auth")],
      claimConditionsJson: stringifyClaims({
        stringLike: { email: ["*@YOUR_PROJECT.iam.gserviceaccount.com"] },
      }),
    }),
    exampleSnippet: (projectId) => `import { StackServerApp, fromGcpMetadata } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  projectId: "${projectId}",
  tokenStore: "memory",
  auth: { oidcFederation: fromGcpMetadata({ audience: "stack-auth" }) },
});
`,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Any OIDC-compliant issuer with a discovery URL",
    seed: () => ({
      displayName: "Custom IdP",
      issuerUrl: "https://issuer.example.com",
      audiences: [newAudienceRow("")],
      claimConditionsJson: stringifyClaims({}),
    }),
    exampleSnippet: (projectId) => `import { StackServerApp, fromOidcToken } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  projectId: "${projectId}",
  tokenStore: "memory",
  auth: { oidcFederation: fromOidcToken(async () => process.env.MY_OIDC_TOKEN!) },
});
`,
  },
];

type StepId = "identity" | "audiences" | "conditions" | "token";
const STEPS: Array<{ id: StepId, label: string }> = [
  { id: "identity", label: "Identity" },
  { id: "audiences", label: "Audiences" },
  { id: "conditions", label: "Conditions" },
  { id: "token", label: "Token" },
];

function issueKindsForStep(step: StepId): DraftValidationIssue["kind"][] {
  switch (step) {
    case "identity": {
      return ["missing-display-name", "missing-issuer"];
    }
    case "audiences": {
      return ["missing-audiences"];
    }
    case "conditions": {
      return ["invalid-claim-conditions-json"];
    }
    case "token": {
      return ["invalid-ttl"];
    }
  }
}

export function OidcPolicyDialog(props: {
  open: boolean,
  mode: "create" | "edit",
  initial: PolicyDraft,
  projectId: string,
  onSave: (policy: TrustPolicy, draft: PolicyDraft) => Promise<void>,
  onClose: () => void,
  adminApp: StackAdminApp<false>,
}) {
  const [draft, setDraft] = useState<PolicyDraft>(props.initial);
  const [preset, setPreset] = useState<string>("custom");
  const [step, setStep] = useState<StepId>("identity");
  const [discoveryState, setDiscoveryState] = useState<DiscoveryProbeResult | { kind: "idle" } | { kind: "loading" }>({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  const issues = validateDraft(draft);
  const issueByKind = useMemo(() => new Map(issues.map(i => [i.kind, i])), [issues]);
  const stepHasIssue = (s: StepId) => issueKindsForStep(s).some(k => issueByKind.has(k));

  const applyPreset = (presetId: string) => {
    setPreset(presetId);
    const p = PRESETS.find(x => x.id === presetId);
    if (!p) return;
    setDraft(prev => ({ ...prev, ...p.seed() }));
    setDiscoveryState({ kind: "idle" });
  };
  const selectedPreset = PRESETS.find(p => p.id === preset);

  const updateAudienceRow = (rowId: string, value: string) => {
    setDraft(d => ({ ...d, audiences: d.audiences.map(a => a.rowId === rowId ? { ...a, value } : a) }));
  };
  const addAudienceRow = () => setDraft(d => ({ ...d, audiences: [...d.audiences, newAudienceRow()] }));
  const removeAudienceRow = (rowId: string) => {
    setDraft(d => ({ ...d, audiences: d.audiences.length > 1 ? d.audiences.filter(a => a.rowId !== rowId) : d.audiences }));
  };

  const runDiscovery = async () => {
    setDiscoveryState({ kind: "loading" });
    const result = await props.adminApp.probeOidcDiscovery({ issuerUrl: draft.issuerUrl });
    setDiscoveryState(
      result.status === "ok"
        ? { kind: "ok", issuer: result.data.issuer, jwksUri: result.data.jwksUri }
        : { kind: "error", reason: result.error.errorMessage },
    );
  };

  const stepIndex = STEPS.findIndex(s => s.id === step);
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;
  const canAdvance = !stepHasIssue(step);

  const handleNext = () => {
    if (!canAdvance) return;
    setStep(STEPS[Math.min(stepIndex + 1, STEPS.length - 1)].id);
  };
  const handleBack = () => {
    setStep(STEPS[Math.max(stepIndex - 1, 0)].id);
  };
  const handleSave = async () => {
    if (issues.length > 0) {
      const firstBad = STEPS.find(s => stepHasIssue(s.id));
      if (firstBad) setStep(firstBad.id);
      return;
    }
    setSaving(true);
    try {
      await props.onSave(draftToPolicy(draft), draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="h-4 w-4" />
            {props.mode === "create" ? "Add OIDC trust policy" : "Edit OIDC trust policy"}
          </DialogTitle>
          <DialogDescription>
            Let deployed workloads exchange a short-lived OIDC token for a Stack server access token.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
          {STEPS.map((s, i) => {
            const active = s.id === step;
            const hasIssue = stepHasIssue(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(s.id)}
                aria-current={active ? "step" : undefined}
                className={
                  "flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " +
                  (active
                    ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.08]"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]")
                }
              >
                <span className={
                  "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold " +
                  (hasIssue ? "bg-destructive/15 text-destructive" : active ? "bg-foreground/[0.08] text-foreground" : "bg-foreground/[0.05] text-muted-foreground")
                }>
                  {i + 1}
                </span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto pr-1">
          {step === "identity" && (
            <IdentityStep
              isCreate={props.mode === "create"}
              preset={preset}
              applyPreset={applyPreset}
              selectedPreset={selectedPreset}
              draft={draft}
              setDraft={setDraft}
              discoveryState={discoveryState}
              setDiscoveryState={setDiscoveryState}
              runDiscovery={() => runAsynchronouslyWithAlert(runDiscovery())}
            />
          )}
          {step === "audiences" && (
            <AudiencesStep
              draft={draft}
              addAudienceRow={addAudienceRow}
              removeAudienceRow={removeAudienceRow}
              updateAudienceRow={updateAudienceRow}
            />
          )}
          {step === "conditions" && (
            <ConditionsStep draft={draft} setDraft={setDraft} />
          )}
          {step === "token" && (
            <TokenStep
              draft={draft}
              setDraft={setDraft}
              isCreate={props.mode === "create"}
              selectedPreset={selectedPreset}
              projectId={props.projectId}
            />
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <DesignButton variant="ghost" onClick={props.onClose}>Cancel</DesignButton>
          <div className="flex items-center gap-2">
            <DesignButton variant="outline" onClick={handleBack} disabled={isFirst}>Back</DesignButton>
            {isLast ? (
              <DesignButton onClick={() => runAsynchronouslyWithAlert(handleSave())} disabled={saving || issues.length > 0}>
                {saving ? "Saving…" : "Save"}
              </DesignButton>
            ) : (
              <DesignButton onClick={handleNext} disabled={!canAdvance}>Next</DesignButton>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Step components ───────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}

function Field({ id, label, children }: { id?: string, label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      {children}
    </div>
  );
}

function IdentityStep(props: {
  isCreate: boolean,
  preset: string,
  applyPreset: (id: string) => void,
  selectedPreset: Preset | undefined,
  draft: PolicyDraft,
  setDraft: (fn: (d: PolicyDraft) => PolicyDraft) => void,
  discoveryState: DiscoveryProbeResult | { kind: "idle" } | { kind: "loading" },
  setDiscoveryState: (s: DiscoveryProbeResult | { kind: "idle" } | { kind: "loading" }) => void,
  runDiscovery: () => void,
}) {
  return (
    <>
      {props.isCreate && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Preset</SectionLabel>
          <DesignPillToggle
            options={PRESETS.map(p => ({ id: p.id, label: p.label }))}
            selected={props.preset}
            onSelect={props.applyPreset}
            size="sm"
            gradient="default"
          />
          {props.selectedPreset && (
            <Typography variant="secondary" className="text-xs">
              {props.selectedPreset.description}
            </Typography>
          )}
        </section>
      )}
      <section className="flex flex-col gap-3">
        <SectionLabel>Identity</SectionLabel>
        <Field id="oidc-name" label="Display name">
          <DesignInput
            id="oidc-name"
            value={props.draft.displayName}
            onChange={(e) => props.setDraft(d => ({ ...d, displayName: e.target.value }))}
            placeholder="e.g. Vercel production"
          />
        </Field>
        <Field id="oidc-issuer" label="Issuer URL">
          <div className="flex gap-2 items-start">
            <DesignInput
              id="oidc-issuer"
              className="flex-1"
              leadingIcon={<GlobeHemisphereWestIcon className="h-4 w-4" />}
              value={props.draft.issuerUrl}
              onChange={(e) => {
                props.setDraft(d => ({ ...d, issuerUrl: e.target.value }));
                props.setDiscoveryState({ kind: "idle" });
              }}
              placeholder="https://oidc.example.com"
            />
            <DesignButton
              variant="outline"
              onClick={props.runDiscovery}
              loading={props.discoveryState.kind === "loading"}
            >
              Discover
            </DesignButton>
          </div>
          <DiscoveryHint state={props.discoveryState} issuerUrl={props.draft.issuerUrl} />
        </Field>
      </section>
    </>
  );
}

function AudiencesStep(props: {
  draft: PolicyDraft,
  addAudienceRow: () => void,
  removeAudienceRow: (rowId: string) => void,
  updateAudienceRow: (rowId: string, value: string) => void,
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <SectionLabel>Audiences</SectionLabel>
        <DesignButton variant="ghost" size="sm" onClick={props.addAudienceRow}>
          <PlusIcon className="h-3.5 w-3.5 mr-1" weight="bold" />
          Add audience
        </DesignButton>
      </div>
      <Typography variant="secondary" className="text-xs">
        At least one required. The incoming token&apos;s <code className="rounded bg-muted px-1 py-0.5">aud</code> claim must match any listed value.
      </Typography>
      <div className="flex flex-col gap-2">
        {props.draft.audiences.map(a => (
          <div key={a.rowId} className="flex gap-2">
            <DesignInput
              className="flex-1"
              leadingIcon={<LinkSimpleIcon className="h-4 w-4" />}
              value={a.value}
              onChange={(e) => props.updateAudienceRow(a.rowId, e.target.value)}
              placeholder="https://example.com/aud"
            />
            <DesignButton
              variant="ghost"
              size="icon"
              onClick={() => props.removeAudienceRow(a.rowId)}
              disabled={props.draft.audiences.length <= 1}
              aria-label="Remove audience"
            >
              <TrashIcon className="h-4 w-4" />
            </DesignButton>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConditionsStep(props: {
  draft: PolicyDraft,
  setDraft: (fn: (d: PolicyDraft) => PolicyDraft) => void,
}) {
  const parseResult = parseClaimConditionsJson(props.draft.claimConditionsJson);
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Claim conditions</SectionLabel>
      <Typography variant="secondary" className="text-xs">
        JSON with <code className="rounded bg-muted px-1 py-0.5">stringEquals</code> and/or <code className="rounded bg-muted px-1 py-0.5">stringLike</code>. Each maps a claim to allowed values. Claims combine with AND; values within a claim combine with OR. <code className="rounded bg-muted px-1 py-0.5">stringLike</code> supports <code className="rounded bg-muted px-1 py-0.5">*</code> / <code className="rounded bg-muted px-1 py-0.5">?</code>. Empty = any validly-signed token with a matching audience passes.
      </Typography>
      <Textarea
        rows={12}
        value={props.draft.claimConditionsJson}
        onChange={(e) => props.setDraft(d => ({ ...d, claimConditionsJson: e.target.value }))}
        className="text-xs font-mono rounded-xl"
        spellCheck={false}
        placeholder={`{\n  "stringEquals": { "environment": ["production"] },\n  "stringLike": { "sub": ["repo:acme/*"] }\n}`}
      />
      {parseResult.kind === "error" && (
        <DesignAlert variant="error" title="Invalid JSON" description={parseResult.reason} />
      )}
    </section>
  );
}

function TokenStep(props: {
  draft: PolicyDraft,
  setDraft: (fn: (d: PolicyDraft) => PolicyDraft) => void,
  isCreate: boolean,
  selectedPreset: Preset | undefined,
  projectId: string,
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionLabel>Issued token</SectionLabel>
        <Field id="oidc-ttl" label="TTL (seconds)">
          <DesignInput
            id="oidc-ttl"
            type="number"
            min={30}
            max={3600}
            leadingIcon={<ClockIcon className="h-4 w-4" />}
            value={props.draft.tokenTtlSeconds}
            onChange={(e) => props.setDraft(d => ({ ...d, tokenTtlSeconds: Number(e.target.value) || 900 }))}
          />
        </Field>
        <Typography variant="secondary" className="text-xs">
          How long the minted Stack server access token stays valid. Must be between 30 and 3600 seconds.
        </Typography>
      </section>
      {props.isCreate && props.selectedPreset && (
        <section className="flex flex-col gap-2">
          <SectionLabel>SDK snippet</SectionLabel>
          <pre className="text-xs bg-muted/60 ring-1 ring-border rounded-xl p-3 overflow-x-auto leading-relaxed">
            {props.selectedPreset.exampleSnippet(props.projectId)}
          </pre>
        </section>
      )}
    </>
  );
}

function DiscoveryHint({ state, issuerUrl }: { state: DiscoveryProbeResult | { kind: "idle" } | { kind: "loading" }, issuerUrl: string }) {
  if (state.kind === "idle") {
    return (
      <Typography variant="secondary" className="text-xs">
        The backend fetches <code className="rounded bg-muted px-1 py-0.5">{issuerUrl || "<issuer>"}/.well-known/openid-configuration</code> on every exchange — click Discover to validate now.
      </Typography>
    );
  }
  if (state.kind === "loading") {
    return (
      <Typography variant="secondary" className="text-xs">
        Fetching discovery document…
      </Typography>
    );
  }
  if (state.kind === "ok") {
    return (
      <DesignAlert
        variant="success"
        title="Discovery OK"
        description={<>issuer <code className="rounded bg-muted px-1 py-0.5">{state.issuer}</code>, jwks_uri <code className="rounded bg-muted px-1 py-0.5">{state.jwksUri}</code></>}
      />
    );
  }
  return <DesignAlert variant="error" title="Discovery failed" description={state.reason} />;
}

export function emptyPolicyDraft(): PolicyDraft {
  return emptyDraft();
}
