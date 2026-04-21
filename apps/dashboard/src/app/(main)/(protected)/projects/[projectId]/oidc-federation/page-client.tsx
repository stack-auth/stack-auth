"use client";

import {
  DesignAlert,
  DesignButton,
  DesignCard,
  DesignEmptyState,
  DesignInput,
  DesignPillToggle,
} from "@/components/design-components";
import { DesignMenu } from "@/components/design-components/menu";
import { ActionDialog, Label, Switch, Textarea, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import {
  ClockIcon,
  FunnelIcon,
  GlobeHemisphereWestIcon,
  LinkSimpleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useMemo, useState } from "react";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import {
  DiscoveryProbeResult,
  PolicyDraft,
  TrustPolicy,
  draftToPolicy,
  emptyDraft,
  newAudienceRow,
  policyToDraft,
  validateDraft
} from "./policy-form";

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
      displayName: "GitHub Actions (acme/app)",
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

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const [dialogState, setDialogState] = useState<{ mode: "create" } | { mode: "edit", draft: PolicyDraft } | null>(null);

  const policies = useMemo(
    (): ReadonlyArray<readonly [string, TrustPolicy]> => Object.entries(config.oidcFederation.trustPolicies),
    [config.oidcFederation.trustPolicies],
  );

  const savePolicy = async (draft: PolicyDraft, isCreate: boolean) => {
    const id = isCreate ? generateUuid() : draft.id;
    if (!id) throw new StackAssertionError("Trust policy ID missing on save");
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`oidcFederation.trustPolicies.${id}`]: draftToPolicy(draft),
      },
      pushable: false,
    });
  };

  const deletePolicy = async (id: string) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`oidcFederation.trustPolicies.${id}`]: null,
      },
      pushable: false,
    });
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`oidcFederation.trustPolicies.${id}.enabled`]: enabled,
      },
      pushable: false,
    });
  };

  return (
    <PageLayout
      title="OIDC Federation"
      description="Let deployed workloads exchange a short-lived OIDC token (Vercel, GitHub Actions, GCP, or any OIDC IdP) for a Stack server access token — no long-lived secret server key needed."
      actions={
        <DesignButton onClick={() => setDialogState({ mode: "create" })}>
          <PlusIcon className="h-4 w-4 mr-1.5" weight="bold" />
          Add trust policy
        </DesignButton>
      }
    >
      {policies.length === 0 ? (
        <DesignCard glassmorphic gradient="default">
          <DesignEmptyState
            icon={ShieldCheckIcon}
            title="No trust policies yet"
            description="Add a policy to let workloads on Vercel, GitHub Actions, GCP, or any OIDC IdP exchange their runtime token for a short-lived Stack server access token."
          >
            <DesignButton onClick={() => setDialogState({ mode: "create" })}>
              <PlusIcon className="h-4 w-4 mr-1.5" weight="bold" />
              Add trust policy
            </DesignButton>
          </DesignEmptyState>
        </DesignCard>
      ) : (
        <div className="flex flex-col gap-3">
          {policies.map(([id, policy]) => (
            <PolicyCard
              key={id}
              policy={policy}
              onEdit={() => setDialogState({ mode: "edit", draft: policyToDraft(id, policy) })}
              onToggle={(enabled) => runAsynchronouslyWithAlert(toggleEnabled(id, enabled))}
              onDelete={() => runAsynchronouslyWithAlert(deletePolicy(id))}
            />
          ))}
        </div>
      )}

      {dialogState && (
        <PolicyDialog
          open
          initial={dialogState.mode === "edit" ? dialogState.draft : emptyDraft()}
          isCreate={dialogState.mode === "create"}
          onClose={() => setDialogState(null)}
          onSave={async (draft) => {
            await savePolicy(draft, dialogState.mode === "create");
            setDialogState(null);
          }}
          projectId={project.id}
          probeDiscovery={async (issuerUrl) => {
            const result = await stackAdminApp.probeOidcDiscovery({ issuerUrl });
            if (result.status === "ok") {
              return { kind: "ok", issuer: result.data.issuer, jwksUri: result.data.jwksUri };
            }
            return { kind: "error", reason: result.error.errorMessage };
          }}
        />
      )}
    </PageLayout>
  );
}

// --- Policy row ----------------------------------------------------------

function PolicyCard(props: {
  policy: TrustPolicy,
  onEdit: () => void,
  onToggle: (enabled: boolean) => void,
  onDelete: () => void,
}) {
  const { policy } = props;
  const enabled = policy.enabled;
  const audienceList = Object.values(policy.audiences ?? {}).filter((v): v is string => typeof v === "string");
  const equalsCount = Object.keys(policy.claimConditions.stringEquals ?? {}).length;
  const likeCount = Object.keys(policy.claimConditions.stringLike ?? {}).length;
  const conditionCount = equalsCount + likeCount;

  return (
    <DesignCard glassmorphic gradient="default" contentClassName="p-4">
      <div className="flex items-center justify-between gap-4">
        <div
          role="button"
          tabIndex={0}
          onClick={props.onEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onEdit();
            }
          }}
          className="flex items-center gap-4 min-w-0 flex-1 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1]"
        >
          <div className="p-2.5 rounded-xl bg-foreground/[0.04] ring-1 ring-foreground/[0.06] shrink-0">
            <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Typography className="font-semibold text-foreground truncate">
                {policy.displayName || "(unnamed policy)"}
              </Typography>
            </div>
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 truncate max-w-[28rem]">
                <GlobeHemisphereWestIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{policy.issuerUrl || "(no issuer)"}</span>
              </span>
              {audienceList.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <LinkSimpleIcon className="h-3.5 w-3.5" />
                  {audienceList.length} {audienceList.length === 1 ? "audience" : "audiences"}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <FunnelIcon className="h-3.5 w-3.5" />
                {conditionCount} {conditionCount === 1 ? "condition" : "conditions"}
              </span>
              {typeof policy.tokenTtlSeconds === "number" && (
                <span className="inline-flex items-center gap-1">
                  <ClockIcon className="h-3.5 w-3.5" />
                  {policy.tokenTtlSeconds}s TTL
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => props.onToggle(checked)}
              aria-label={enabled ? "Disable policy" : "Enable policy"}
            />
          </div>
          <DesignMenu
            variant="actions"
            trigger="icon"
            align="end"
            items={[
              { id: "edit", label: "Edit", onClick: props.onEdit },
              { id: "delete", label: "Delete", onClick: props.onDelete, itemVariant: "destructive" },
            ]}
          />
        </div>
      </div>
    </DesignCard>
  );
}

// --- Policy dialog -------------------------------------------------------

function PolicyDialog(props: {
  open: boolean,
  initial: PolicyDraft,
  isCreate: boolean,
  onSave: (draft: PolicyDraft) => Promise<void>,
  onClose: () => void,
  projectId: string,
  probeDiscovery: (issuerUrl: string) => Promise<DiscoveryProbeResult>,
}) {
  const [draft, setDraft] = useState<PolicyDraft>(props.initial);
  const [preset, setPreset] = useState<string>("custom");
  const [discoveryState, setDiscoveryState] = useState<DiscoveryProbeResult | { kind: "idle" } | { kind: "loading" }>({ kind: "idle" });

  const applyPreset = (presetId: string) => {
    setPreset(presetId);
    const p = PRESETS.find(x => x.id === presetId);
    if (!p) return;
    setDraft(prev => ({ ...prev, ...p.seed() }));
    setDiscoveryState({ kind: "idle" });
  };

  const selectedPreset = PRESETS.find(p => p.id === preset);
  const issues = validateDraft(draft);

  const updateAudienceRow = (rowId: string, value: string) => {
    setDraft(d => ({ ...d, audiences: d.audiences.map(a => a.rowId === rowId ? { ...a, value } : a) }));
  };
  const addAudienceRow = () => setDraft(d => ({ ...d, audiences: [...d.audiences, newAudienceRow()] }));
  const removeAudienceRow = (rowId: string) => {
    setDraft(d => ({ ...d, audiences: d.audiences.length > 1 ? d.audiences.filter(a => a.rowId !== rowId) : d.audiences }));
  };

  const runDiscovery = async () => {
    setDiscoveryState({ kind: "loading" });
    const result = await props.probeDiscovery(draft.issuerUrl);
    setDiscoveryState(result);
  };

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={props.isCreate ? "Add OIDC trust policy" : "Edit OIDC trust policy"}
      description="Define the IdP, audiences, and claim conditions a workload token must satisfy to exchange for a Stack server access token."
      okButton={{
        label: "Save",
        onClick: async () => {
          if (issues.length > 0) throw new Error(`Fix validation issues first: ${issues.map(i => i.kind).join(", ")}`);
          await props.onSave(draft);
        },
      }}
      cancelButton
    >
      <div className="flex flex-col gap-5">
        {props.isCreate && (
          <section className="flex flex-col gap-2">
            <SectionHeading>Preset</SectionHeading>
            <DesignPillToggle
              options={PRESETS.map(p => ({ id: p.id, label: p.label }))}
              selected={preset}
              onSelect={applyPreset}
              size="sm"
              gradient="default"
            />
            {selectedPreset && (
              <Typography variant="secondary" className="text-xs">
                {selectedPreset.description}
              </Typography>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <SectionHeading>Identity</SectionHeading>
          <Field id="oidc-name" label="Display name">
            <DesignInput
              id="oidc-name"
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder="e.g. Vercel production"
            />
          </Field>
          <Field id="oidc-issuer" label="Issuer URL">
            <div className="flex gap-2 items-start">
              <DesignInput
                id="oidc-issuer"
                className="flex-1"
                leadingIcon={<GlobeHemisphereWestIcon className="h-4 w-4" />}
                value={draft.issuerUrl}
                onChange={(e) => {
                  setDraft({ ...draft, issuerUrl: e.target.value });
                  setDiscoveryState({ kind: "idle" });
                }}
                placeholder="https://oidc.example.com"
              />
              <DesignButton
                variant="outline"
                onClick={runDiscovery}
                loading={discoveryState.kind === "loading"}
              >
                Discover
              </DesignButton>
            </div>
            <DiscoveryHint state={discoveryState} issuerUrl={draft.issuerUrl} />
          </Field>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionHeading>Audiences</SectionHeading>
            <DesignButton variant="ghost" size="sm" onClick={addAudienceRow}>
              <PlusIcon className="h-3.5 w-3.5 mr-1" weight="bold" />
              Add audience
            </DesignButton>
          </div>
          <Typography variant="secondary" className="text-xs">
            At least one required. The incoming token&apos;s <code className="rounded bg-muted px-1 py-0.5">aud</code> claim must match any listed value.
          </Typography>
          <div className="flex flex-col gap-2">
            {draft.audiences.map(a => (
              <div key={a.rowId} className="flex gap-2">
                <DesignInput
                  className="flex-1"
                  leadingIcon={<LinkSimpleIcon className="h-4 w-4" />}
                  value={a.value}
                  onChange={(e) => updateAudienceRow(a.rowId, e.target.value)}
                  placeholder="https://example.com/aud"
                />
                <DesignButton
                  variant="ghost"
                  size="icon"
                  onClick={() => removeAudienceRow(a.rowId)}
                  disabled={draft.audiences.length <= 1}
                  aria-label="Remove audience"
                >
                  <TrashIcon className="h-4 w-4" />
                </DesignButton>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeading>Claim conditions</SectionHeading>
          <Typography variant="secondary" className="text-xs">
            JSON object with <code className="rounded bg-muted px-1 py-0.5">stringEquals</code> and/or <code className="rounded bg-muted px-1 py-0.5">stringLike</code>. Each maps claim names to arrays of allowed values. All claims must match (AND); values within a claim match with OR. <code className="rounded bg-muted px-1 py-0.5">stringLike</code> supports <code className="rounded bg-muted px-1 py-0.5">*</code> / <code className="rounded bg-muted px-1 py-0.5">?</code> wildcards. Empty = any validly-signed token with a matching audience is accepted.
          </Typography>
          <Textarea
            rows={10}
            value={draft.claimConditionsJson}
            onChange={(e) => setDraft({ ...draft, claimConditionsJson: e.target.value })}
            className="text-xs font-mono rounded-xl"
            spellCheck={false}
            placeholder={`{\n  "stringEquals": { "environment": ["production"] },\n  "stringLike": { "sub": ["repo:acme/*"] }\n}`}
          />
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeading>Issued token</SectionHeading>
          <Field id="oidc-ttl" label="TTL (seconds)">
            <DesignInput
              id="oidc-ttl"
              type="number"
              min={30}
              max={3600}
              leadingIcon={<ClockIcon className="h-4 w-4" />}
              value={draft.tokenTtlSeconds}
              onChange={(e) => setDraft({ ...draft, tokenTtlSeconds: Number(e.target.value) || 900 })}
            />
          </Field>
          <Typography variant="secondary" className="text-xs">
            How long the minted Stack server access token stays valid. Must be between 30 and 3600 seconds.
          </Typography>
        </section>

        {props.isCreate && selectedPreset && (
          <section className="flex flex-col gap-2">
            <SectionHeading>SDK snippet</SectionHeading>
            <pre className="text-xs bg-muted/60 ring-1 ring-border rounded-xl p-3 overflow-x-auto leading-relaxed">
              {selectedPreset.exampleSnippet(props.projectId)}
            </pre>
          </section>
        )}

        {issues.length > 0 && (
          <DesignAlert
            variant="error"
            title="Fix these issues before saving"
            description={
              <ul className="list-disc pl-5 space-y-0.5">
                {issues.map(i => <li key={i.kind}>{humanizeIssue(i)}</li>)}
              </ul>
            }
          />
        )}
      </div>
    </ActionDialog>
  );
}

// --- Local helpers -------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Field({ id, label, children }: { id?: string, label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      {children}
    </div>
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
  return (
    <DesignAlert
      variant="error"
      title="Discovery failed"
      description={state.reason}
    />
  );
}

function humanizeIssue(issue: { kind: string, reason?: string }): string {
  switch (issue.kind) {
    case "missing-display-name": {
      return "Display name is required";
    }
    case "missing-issuer": {
      return "Issuer URL is required";
    }
    case "missing-audiences": {
      return "At least one audience is required";
    }
    case "invalid-ttl": {
      return "Token TTL must be between 30 and 3600 seconds";
    }
    case "invalid-claim-conditions-json": {
      return `Claim conditions JSON is invalid: ${issue.reason ?? "parse error"}`;
    }
    default: {
      return issue.kind;
    }
  }
}
