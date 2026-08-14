"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
  DesignSelectorDropdown,
  DesignSkeleton,
} from "@/components/design-components";
import { Typography } from "@/components/ui";
import {
  AD_ACCOUNT_PLACEHOLDER_ID,
  AD_OBJECTIVE_LABELS,
  AD_PREVIEW_LIMITS,
  AD_SPECIAL_AD_CATEGORY_LABELS,
  adCampaignSpecSchema,
  summarizeAdTargeting,
  type AdCampaignSpec,
} from "@/lib/ad-platforms/campaign-spec-types";
import type { AdPlatformAccount } from "@/lib/ad-platforms/ad-platform-types";
import { useAdPlatformStatus } from "@/lib/ad-platforms/use-ad-platform-status";
import { useAdCreativeImage } from "@/lib/ad-platforms/use-ad-creative-image";
import { fetchAdPlatformInsights } from "@/lib/ad-platforms/ad-platforms-api";
import { formatGrowthAdSpend } from "@/lib/growth/growth-format";
import { activateGrowthAction } from "@/lib/growth/growth-api";
import { GROWTH_ADS_CREATION_STEP_LABELS, type GrowthAdsBody } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import {
  ArrowSquareOutIcon,
  ClockIcon,
  ImageBrokenIcon,
  MegaphoneIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useAdminApp, useProjectId } from "../../../use-admin-app";

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------

/** The action's stored `payload.ad_campaign`, parsed against the dashboard's read mirror of the
 * frozen AdCampaignSpec. Degrades to `null` on any shape mismatch rather than throwing — see the
 * blogPayloadSchema.safeParse pattern this mirrors in page-client.tsx. */
export function parseAdCampaignPayload(payload: unknown): AdCampaignSpec | null {
  if (typeof payload !== "object" || payload == null) return null;
  const record = payload as Record<string, unknown>;
  const parsed = adCampaignSpecSchema.safeParse(record.ad_campaign);
  return parsed.success ? parsed.data : null;
}

function MockBadge(props: { mock: boolean }) {
  if (!props.mock) return null;
  return <DesignBadge label="Mock — no real spend" color="purple" size="sm" />;
}

/** Renders the actual generated creative image (never just a filename), with explicit loading/error states. */
function AdCreativeImagePreview(props: { actionId: string, assetId: string | null }) {
  const state = useAdCreativeImage(props.actionId, props.assetId);
  if (state.status === "loading") {
    return <DesignSkeleton className="h-56 w-full rounded-xl" />;
  }
  if (state.status === "error") {
    return (
      <div className="flex h-56 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/[0.12] bg-foreground/[0.02] text-center">
        <ImageBrokenIcon className="size-6 text-muted-foreground" />
        <Typography variant="secondary" type="footnote" className="max-w-xs">{state.message}</Typography>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- an admin-fetched object URL, not a static asset Next can optimize.
  return <img src={state.objectUrl} alt="Generated ad creative" className="h-56 w-full rounded-xl border border-foreground/[0.08] object-cover" />;
}

function limitCounterClass(length: number, limit: number): string {
  return length > limit ? "text-red-500" : "text-muted-foreground";
}

/**
 * An APPROXIMATE ad preview — labelled as such everywhere it appears, per the frozen contract: this
 * is not pixel-accurate to any real Meta placement, only a rough read of "does the copy fit". Every
 * field shows its live character count against Meta's documented truncation points so the label never
 * goes quiet about how approximate this really is.
 */
function AdPreview(props: { creative: Extract<AdCampaignSpec["creative"], { kind: "link_ad" }> }) {
  const { creative } = props;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-4">
      <div className="flex items-center justify-between">
        <Typography type="label" className="uppercase tracking-wider text-muted-foreground">Approximate preview</Typography>
        <DesignBadge label="Not pixel-accurate to Meta" color="orange" size="sm" />
      </div>
      <div className="rounded-lg border border-foreground/[0.08] bg-background p-3">
        <p className="whitespace-pre-wrap text-sm">
          {creative.primary_text.length > AD_PREVIEW_LIMITS.primaryText
            ? `${creative.primary_text.slice(0, AD_PREVIEW_LIMITS.primaryText)}…`
            : creative.primary_text}
        </p>
        <div className="mt-2 rounded-md border border-foreground/[0.06] bg-foreground/[0.02] p-2">
          <p className="truncate text-sm font-semibold">{creative.headline}</p>
          {creative.description != null && creative.description.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">{creative.description}</p>
          )}
          <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{creative.link_url}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <span className={limitCounterClass(creative.primary_text.length, AD_PREVIEW_LIMITS.primaryText)}>
          Primary text {creative.primary_text.length}/{AD_PREVIEW_LIMITS.primaryText}
        </span>
        <span className={limitCounterClass(creative.headline.length, AD_PREVIEW_LIMITS.headline)}>
          Headline {creative.headline.length}/{AD_PREVIEW_LIMITS.headline}
        </span>
        <span className={limitCounterClass((creative.description ?? "").length, AD_PREVIEW_LIMITS.description)}>
          Description {(creative.description ?? "").length}/{AD_PREVIEW_LIMITS.description}
        </span>
      </div>
    </div>
  );
}

/** Full, unambiguous campaign detail: budget+currency, schedule, targeting, ad copy, destination, image. */
function CampaignDetail(props: { actionId: string, spec: AdCampaignSpec, mock: boolean }) {
  const { spec, mock } = props;
  const creative = spec.creative;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Typography type="label" variant="secondary">Objective</Typography>
          <Typography>{AD_OBJECTIVE_LABELS[spec.objective]}</Typography>
        </div>
        <div>
          <Typography type="label" variant="secondary">Budget</Typography>
          <div className="flex items-center gap-2">
            <Typography className="font-semibold">
              {formatGrowthAdSpend(spec.budget.amount_minor, spec.budget.currency)}
              {" "}/{spec.budget.mode === "daily" ? " day" : " lifetime"}
            </Typography>
            <MockBadge mock={mock} />
          </div>
        </div>
        <div>
          <Typography type="label" variant="secondary">Schedule</Typography>
          <Typography>
            {spec.schedule.start_at_millis == null ? "Starts immediately" : new Date(spec.schedule.start_at_millis).toLocaleDateString()}
            {" – "}
            {spec.schedule.end_at_millis == null ? "No end date" : new Date(spec.schedule.end_at_millis).toLocaleDateString()}
          </Typography>
        </div>
        <div>
          <Typography type="label" variant="secondary">Targeting</Typography>
          <Typography>{summarizeAdTargeting(spec.targeting)}</Typography>
        </div>
      </div>

      <div>
        <Typography type="label" variant="secondary">Special ad categories</Typography>
        <Typography>
          {spec.special_ad_categories.length === 0
            ? "None declared"
            : spec.special_ad_categories.map((category) => AD_SPECIAL_AD_CATEGORY_LABELS[category]).join(", ")}
        </Typography>
      </div>

      {creative.kind === "link_ad" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div>
                <Typography type="label" variant="secondary">Primary text</Typography>
                <Typography className="whitespace-pre-wrap">{creative.primary_text}</Typography>
              </div>
              <div>
                <Typography type="label" variant="secondary">Headline</Typography>
                <Typography>{creative.headline}</Typography>
              </div>
              {creative.description != null && (
                <div>
                  <Typography type="label" variant="secondary">Description</Typography>
                  <Typography>{creative.description}</Typography>
                </div>
              )}
              <div>
                <Typography type="label" variant="secondary">Destination URL</Typography>
                <a href={creative.link_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-2">
                  {creative.link_url}
                  <ArrowSquareOutIcon className="size-3.5" />
                </a>
              </div>
            </div>
            {creative.image.source === "generated" ? (
              <AdCreativeImagePreview actionId={props.actionId} assetId={creative.image.asset_id} />
            ) : (
              <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/[0.12] bg-foreground/[0.02] text-center">
                <ImageBrokenIcon className="size-6 text-muted-foreground" />
                <Typography variant="secondary" type="footnote" className="max-w-xs">
                  {creative.image.source === "unbound"
                    ? "No image has been chosen for this ad yet — it cannot be created in Meta until one is bound."
                    : "This image is referenced by hash/URL rather than generated — no in-app preview is available."}
                </Typography>
              </div>
            )}
          </div>
          <AdPreview creative={creative} />
        </>
      ) : (
        <div>
          <Typography type="label" variant="secondary">Creative</Typography>
          <Typography>Boosts an existing Page post ({creative.object_story_id}).</Typography>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Account picker + category attestation (activate dialog only)
// ---------------------------------------------------------------------------------------------

export function pickDefaultAccount(accounts: AdPlatformAccount[]): AdPlatformAccount | null {
  const funded = accounts.find((account) => account.isActive && account.hasFundingSource);
  if (funded != null) return funded;
  return accounts.length > 0 ? accounts[0] : null;
}

function AdAccountPicker(props: {
  spec: AdCampaignSpec,
  accounts: AdPlatformAccount[],
  selectedAccountId: string | null,
  onSelect: (accountId: string) => void,
}) {
  const { spec, accounts, selectedAccountId, onSelect } = props;
  const isPlaceholder = spec.account_id === AD_ACCOUNT_PLACEHOLDER_ID;
  return (
    <div className="flex flex-col gap-2">
      <Typography type="label" variant="secondary">Ad account</Typography>
      {isPlaceholder && (
        <DesignAlert variant="warning" description="This proposal was authored while Meta was disconnected, so it carries a placeholder account. Pick a real account below." />
      )}
      {accounts.length === 0 ? (
        <DesignAlert variant="error" description="No ad account is visible on this connection — connect Meta or grant access to an ad account before activating." />
      ) : (
        <DesignSelectorDropdown
          value={selectedAccountId ?? ""}
          onValueChange={onSelect}
          size="md"
          options={accounts.map((account) => ({
            value: account.id,
            label: `${account.name} (${account.id})${account.hasFundingSource ? "" : " — no payment method"}${account.isActive ? "" : " — inactive"}`,
            disabled: !account.isActive || !account.hasFundingSource,
          }))}
        />
      )}
      {selectedAccountId != null && selectedAccountId !== spec.account_id && (
        <DesignAlert
          variant="error"
          description={
            "This proposal targets a different account than the one selected. Overriding the account at activation isn't wired up on the backend yet — activation will be blocked until that's added, or you can pick the account this proposal was already written for."
          }
        />
      )}
    </div>
  );
}

export function categoriesAckMatches(spec: string[], ack: string[]): boolean {
  if (spec.length !== ack.length) return false;
  const sortedSpec = [...spec].sort();
  const sortedAck = [...ack].sort();
  return sortedSpec.every((value, index) => value === sortedAck[index]);
}

function SpecialAdCategoryAttestation(props: { spec: AdCampaignSpec, acknowledged: boolean, onChange: (checked: boolean) => void }) {
  const { spec, acknowledged, onChange } = props;
  const declared = spec.special_ad_categories;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-3">
      <Typography type="label" variant="secondary">Special ad category attestation</Typography>
      <Typography type="footnote" variant="secondary">
        Meta requires an accurate, human-confirmed declaration. A wrong declaration is a policy violation
        with account-level consequences — read this carefully before checking it.
      </Typography>
      <label className="flex cursor-pointer items-start gap-2">
        <Checkbox
          checked={acknowledged}
          onCheckedChange={(checked) => onChange(checked === true)}
          className="mt-0.5"
        />
        <span className="text-sm">
          {declared.length === 0 ? (
            <>I confirm this ad is <strong>not</strong> related to housing, credit, employment, social issues/elections/politics, financial products or services, or online gambling and gaming.</>
          ) : (
            <>I confirm this ad IS related to: <strong>{declared.map((category) => AD_SPECIAL_AD_CATEGORY_LABELS[category]).join(", ")}</strong>, and to nothing else in that list.</>
          )}
        </span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Review / Activate dialog
// ---------------------------------------------------------------------------------------------

function ActivateAdCampaignDialog(props: {
  actionId: string,
  spec: AdCampaignSpec,
  demo: boolean,
  onActivated: () => Promise<void>,
}) {
  const { actionId, spec, demo, onActivated } = props;
  const app = useAdminApp();
  const projectId = useProjectId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { state: statusState } = useAdPlatformStatus(projectId, "meta");

  useEffect(() => {
    if (statusState.status === "loaded" && selectedAccountId == null) {
      const defaultAccount = pickDefaultAccount(statusState.value.accounts);
      setSelectedAccountId(defaultAccount?.id ?? null);
    }
    // Only ever set the default once, when accounts first load — never overwrite a user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusState.status]);

  const accounts = statusState.status === "loaded" ? statusState.value.accounts : [];
  const mock = statusState.status === "loaded" && statusState.value.mock;
  const accountMatches = selectedAccountId != null && selectedAccountId === spec.account_id;
  // The single checkbox affirms "the categories shown are accurate", so the ack we'd send is either
  // exactly the spec's own array (checked) or empty (unchecked) — never a third value. Routing that
  // through the same set-equality check the backend enforces (rather than trusting the boolean alone)
  // keeps this gate honest if the attestation UI ever grows per-category checkboxes later.
  const pendingAck = acknowledged ? spec.special_ad_categories : [];
  const categoriesAcknowledged = acknowledged && categoriesAckMatches(spec.special_ad_categories, pendingAck);
  const canActivate = categoriesAcknowledged && accountMatches;

  return (
    <DesignDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
        }
      }}
      trigger={<DesignButton size="sm"><MegaphoneIcon className="size-4" /> Review & activate</DesignButton>}
      icon={MegaphoneIcon}
      size="lg"
      title="Review this campaign before it's created"
      // Says what actually happens now that an AI does the building — and that we check its work.
      // That independent check is the strongest thing we can tell someone about to let an agent into
      // their ad account, so it belongs in the dialog they read before approving, not in a help doc.
      description={demo ? "Demo mode" : "Nothing is created in Meta until you activate. An AI agent then builds this in your account, paused — and we independently check Meta against exactly what you see here (budget, currency, targeting, and that everything is paused) before showing it as created. A separate confirmation is required to spend anything."}
      footer={
        demo ? (
          <DesignDialogClose asChild><DesignButton variant="secondary" size="sm">Close</DesignButton></DesignDialogClose>
        ) : (
          <>
            <DesignDialogClose asChild><DesignButton variant="secondary" size="sm">Cancel</DesignButton></DesignDialogClose>
            <DesignButton
              size="sm"
              disabled={!canActivate}
              onClick={async () => {
                setError(null);
                try {
                  await activateGrowthAction(app, actionId);
                } catch (activateError) {
                  captureError("growth-ads-activate", activateError);
                  setError(activateError instanceof Error ? activateError.message : String(activateError));
                  return;
                }
                setOpen(false);
                await onActivated();
              }}
            >
              Create campaign (paused)
            </DesignButton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {demo ? (
          <DesignAlert variant="info">You are looking at fixture data — campaigns cannot be created in demo mode.</DesignAlert>
        ) : (
          <>
            <MockBadge mock={mock} />
            <CampaignDetail actionId={actionId} spec={spec} mock={mock} />
            {statusState.status === "error" && (
              <DesignAlert variant="error" description={`Couldn't load your Meta ad accounts: ${statusState.message}`} />
            )}
            {statusState.status === "loaded" && (
              <AdAccountPicker spec={spec} accounts={accounts} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} />
            )}
            <SpecialAdCategoryAttestation spec={spec} acknowledged={acknowledged} onChange={setAcknowledged} />
          </>
        )}
        {error != null && <DesignAlert variant="error">This didn&apos;t work: {error}</DesignAlert>}
      </div>
    </DesignDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Created/paused + live panels (post-activation lifecycle)
// ---------------------------------------------------------------------------------------------

const ADS_STATUS_BADGE = new Map<GrowthAdsBody["status"], { label: string, color: "blue" | "green" | "orange" | "red" | "cyan" | "purple" }>([
  ["creating", { label: "Creating", color: "cyan" }],
  ["paused", { label: "Paused", color: "orange" }],
  ["publishing", { label: "Publishing", color: "cyan" }],
  ["active", { label: "Active", color: "green" }],
  ["pausing", { label: "Pausing", color: "cyan" }],
  ["rolled_back", { label: "Rolled back", color: "red" }],
  ["failed", { label: "Failed", color: "red" }],
  ["discarded", { label: "Discarded", color: "orange" }],
]);

/** Meta Ads Manager deep link for a created campaign, scoped to the numeric ad-account id. */
function adsManagerCampaignUrl(accountId: string, campaignId: string): string {
  const numericAccountId = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(numericAccountId)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`;
}

function EntityRow(props: { label: string, entity: { externalId: string, name: string } | { externalId: string } | null, accountId: string, campaignIdForLink: string | null }) {
  const { label, entity } = props;
  if (entity == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{entity.externalId}</span>
      {"name" in entity && <span className="text-muted-foreground">{entity.name}</span>}
      {props.campaignIdForLink != null && (
        <a
          href={adsManagerCampaignUrl(props.accountId, props.campaignIdForLink)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2"
        >
          Open in Ads Manager <ArrowSquareOutIcon className="size-3" />
        </a>
      )}
    </div>
  );
}

function GoLiveDialog(props: { actionId: string, ads: GrowthAdsBody, demo: boolean, onChanged: () => Promise<void> }) {
  const { actionId, ads, demo, onChanged } = props;
  const app = useAdminApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const budgetMode: "daily" | "lifetime" = ads.dailyBudgetMinor != null ? "daily" : "lifetime";
  const budgetMinor = ads.dailyBudgetMinor ?? ads.lifetimeBudgetMinor ?? 0;
  const budgetLabel = formatGrowthAdSpend(budgetMinor, ads.currency);
  const confirmed = confirmText.trim() === budgetLabel;

  return (
    <DesignDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setConfirmText("");
        }
      }}
      trigger={<DesignButton size="sm"><PlayIcon className="size-4" /> Go live</DesignButton>}
      icon={PlayIcon}
      size="md"
      title="Start spending on this campaign?"
      description={demo ? "Demo mode" : "This is the only action in this app that can make a Meta campaign actually spend money."}
      // No publish action: making a campaign spend money requires the ad platform integration, which
      // this build does not have. The dialog stays so the confirmation flow it guards — restate the
      // exact budget, type it back — is not rewritten from scratch when that integration lands.
      footer={<DesignDialogClose asChild><DesignButton variant="secondary" size="sm">Close</DesignButton></DesignDialogClose>}
    >
      <div className="flex flex-col gap-3">
        {demo ? (
          <DesignAlert variant="info">You are looking at fixture data — campaigns cannot be published in demo mode.</DesignAlert>
        ) : (
          <>
            <Typography>
              This campaign&apos;s {budgetMode} budget is <strong>{budgetLabel}</strong>. To confirm you&apos;ve re-read the
              exact figure (not a stale number from an old dialog), type it back below.
            </Typography>
            <input
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={budgetLabel}
              className="rounded-lg border border-foreground/[0.12] bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/[0.2]"
            />
          </>
        )}
        {error != null && <DesignAlert variant="error">This didn&apos;t work: {error}</DesignAlert>}
      </div>
    </DesignDialog>
  );
}

function OrphanedIdsNotice(props: { actionId: string, ads: GrowthAdsBody, demo: boolean, onChanged: () => Promise<void> }) {
  const app = useAdminApp();
  if (props.ads.orphanedExternalIds.length === 0) return null;
  return (
    <DesignAlert variant="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {props.ads.orphanedExternalIds.length} object{props.ads.orphanedExternalIds.length === 1 ? "" : "s"} could not be
          cleaned up in Meta and may still exist there: {props.ads.orphanedExternalIds.join(", ")}.
        </span>

      </div>
    </DesignAlert>
  );
}

function LastErrorNotice(props: { ads: GrowthAdsBody }) {
  const { lastError } = props.ads;
  if (lastError.code == null) return null;
  return (
    <DesignAlert variant="error" title="Meta reported an error">
      {/* Numeric codes only per the frozen contract — Meta's raw error message is never safe to
          echo (it can carry the request's access_token query param), so this deliberately never
          renders lastError anything but the stage/code/subcode triple. */}
      <span className="font-mono text-xs">
        stage={lastError.stage ?? "?"} code={lastError.code} subcode={lastError.subcode ?? "?"}
      </span>
    </DesignAlert>
  );
}

function CreatedPausedPanel(props: { actionId: string, ads: GrowthAdsBody, demo: boolean, onChanged: () => Promise<void> }) {
  const { actionId, ads, demo, onChanged } = props;
  const campaignId = ads.campaign?.externalId ?? null;
  return (
    <div className="flex flex-col gap-4">
      {/*
        Two different answers, kept apart on purpose. `mayBeLiveUnconfirmed` means we could not reach
        Meta at all — we genuinely do not know whether money is moving, so it is an error.
        `publishInProgress` means Meta answered and told us it is still publishing — we DO know, and
        the answer is "not live yet". Meta's own tooling is explicit that a PUBLISHING entity must not
        be reported as live, and merging these two would turn a known state into an unknown one.
      */}
      {ads.mayBeLiveUnconfirmed && (
        <DesignAlert variant="error" title="We can't confirm whether this is spending money right now">
          We attempted to start this campaign but could not reach Meta to confirm the result. Refresh in a
          moment — if this persists, check your Meta connection.
        </DesignAlert>
      )}
      {ads.publishInProgress && !ads.mayBeLiveUnconfirmed && (
        <DesignAlert variant="info" title="Meta is still publishing this campaign">
          Your change has been accepted and Meta is applying it. This is <strong>not live yet</strong> — it
          will start delivering once Meta finishes.
        </DesignAlert>
      )}
      <LastErrorNotice ads={ads} />
      <OrphanedIdsNotice actionId={actionId} ads={ads} demo={demo} onChanged={onChanged} />
      <div className="flex flex-col gap-1.5">
        <EntityRow label="Campaign" entity={ads.campaign} accountId={ads.accountId} campaignIdForLink={campaignId} />
        <EntityRow label="Ad set" entity={ads.adSet} accountId={ads.accountId} campaignIdForLink={null} />
        <EntityRow label="Creative" entity={ads.creative} accountId={ads.accountId} campaignIdForLink={null} />
        <EntityRow label="Ad" entity={ads.ad} accountId={ads.accountId} campaignIdForLink={null} />
      </div>
      {ads.status === "paused" && (
        <div>
          <GoLiveDialog actionId={actionId} ads={ads} demo={demo} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

type LiveInsightsRow = {
  spendMinor: number,
  impressions: number,
  clicks: number,
  ctr: number | null,
  cpaLabel: string | null,
};

function LiveCampaignPanel(props: { actionId: string, ads: GrowthAdsBody, demo: boolean, onChanged: () => Promise<void> }) {
  const { actionId, ads, demo, onChanged } = props;
  const app = useAdminApp();
  const projectId = useProjectId();
  const [insights, setInsights] = useState<{ status: "loading" } | { status: "error", message: string } | { status: "loaded", value: LiveInsightsRow | null }>({ status: "loading" });
  const campaignId = ads.campaign?.externalId ?? null;

  const load = useCallback(async () => {
    if (demo || campaignId == null) {
      setInsights({ status: "loaded", value: null });
      return;
    }
    try {
      const until = new Date().toISOString().slice(0, 10);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      // Scoped to exactly this one campaign's id — never fanned out across a list of cards, per the
      // frozen contract's rate-limit warning.
      const result = await fetchAdPlatformInsights(projectId, "meta", {
        accountId: ads.accountId,
        level: "campaign",
        objectIds: [campaignId],
        since,
        until,
        timeIncrement: "all",
      });
      if (result.rows.length === 0) {
        setInsights({ status: "loaded", value: null });
        return;
      }
      const row = result.rows[0];
      const actionsWithCost = row.actions.filter((action) => action.costPerActionMinor != null).sort((a, b) => b.count - a.count);
      const bestAction = actionsWithCost.length > 0 ? actionsWithCost[0] : null;
      setInsights({
        status: "loaded",
        value: {
          spendMinor: row.spendMinor,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr,
          cpaLabel: bestAction == null || bestAction.costPerActionMinor == null
            ? null
            : `${formatGrowthAdSpend(bestAction.costPerActionMinor, ads.currency)} / ${bestAction.actionType}`,
        },
      });
    } catch (error) {
      captureError("growth-ads-insights", error);
      setInsights({ status: "error", message: error instanceof Error ? error.message : "Couldn't load performance." });
    }
  }, [projectId, demo, campaignId, ads.accountId, ads.currency]);

  useEffect(() => {
    runAsynchronously(load());
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <LastErrorNotice ads={ads} />
      {insights.status === "error" && <DesignAlert variant="warning" description={insights.message} />}
      {insights.status === "loading" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => <DesignSkeleton key={index} className="h-16 rounded-xl" />)}
        </div>
      )}
      {insights.status === "loaded" && (
        insights.value == null ? (
          <DesignAlert variant="default" description={demo ? "Demo mode — performance is illustrative." : "No performance data reported yet."} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Spend", formatGrowthAdSpend(insights.value.spendMinor, ads.currency)],
              ["Impressions", insights.value.impressions.toLocaleString()],
              ["Clicks", insights.value.clicks.toLocaleString()],
              ["CTR", insights.value.ctr == null ? "—" : `${(insights.value.ctr * 100).toFixed(2)}%`],
              ["CPA", insights.value.cpaLabel ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3">
                <Typography type="label" variant="secondary">{label}</Typography>
                <Typography className="font-semibold">{value}</Typography>
              </div>
            ))}
          </div>
        )
      )}
      <div className="flex flex-col gap-1.5">
        <EntityRow label="Campaign" entity={ads.campaign} accountId={ads.accountId} campaignIdForLink={campaignId} />
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Top-level: proposed vs activated lifecycle
// ---------------------------------------------------------------------------------------------

/** Fetches the campaign lifecycle row for an activated run_ads item and dispatches by status. */
/**
 * The build stepper shown while an AI session is assembling the campaign.
 *
 * `creationStep` is the backend's coarse lifecycle phase, not a per-call progress bar — the backend
 * genuinely cannot see the agent's individual Meta calls, so anything finer-grained here would be
 * invented. Four honest stages is what we actually know.
 */
const ADS_BUILD_STAGES: readonly { step: string, label: string }[] = [
  { step: "claiming", label: "Claiming" },
  { step: "anchored", label: "Created in Meta (paused)" },
  { step: "dispatched", label: "Agent building" },
  { step: "verifying", label: "Checking against your approved campaign" },
];

function AdsBuildProgress(props: { ads: GrowthAdsBody }) {
  const { ads } = props;
  const activeIndex = ADS_BUILD_STAGES.findIndex((stage) => stage.step === ads.creationStep);
  const leaseExpired = ads.execution.leaseExpiresAtMillis != null && ads.execution.leaseExpiresAtMillis < Date.now();

  return (
    <DesignCard className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Typography type="label">Building your campaign</Typography>
        {ads.execution.attempt != null && ads.execution.attempt > 1 && (
          <DesignBadge label={`Attempt ${ads.execution.attempt}`} color="orange" size="sm" />
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {ADS_BUILD_STAGES.map((stage, index) => {
          // -1 (an unrecognized step) deliberately renders every stage as pending rather than
          // guessing a position — an unknown phase means we do not know how far along it is.
          const done = activeIndex >= 0 && index < activeIndex;
          const current = index === activeIndex;
          return (
            <li key={stage.step} className="flex items-center gap-2 text-sm">
              <span className={`size-1.5 rounded-full ${done ? "bg-emerald-500" : current ? "bg-blue-500" : "bg-muted-foreground/30"}`} />
              <span className={current ? "font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/60"}>{stage.label}</span>
            </li>
          );
        })}
      </ol>
      <Typography type="footnote" variant="secondary">
        Nothing is live and nothing is spending while this runs — everything the agent builds is created paused.
      </Typography>
      {leaseExpired && (
        <DesignAlert
          variant="warning"
          description="This build has run past its time limit. We'll check your account and report what actually exists — you don't need to do anything."
        />
      )}
    </DesignCard>
  );
}

/**
 * What our own read of the account found, when it disagrees with the approved campaign.
 *
 * Never collapsed and never auto-dismissed: a quarantine means we could not confirm the campaign
 * matches what a human approved, which is the one thing this whole verification pass exists to catch.
 */
function VerificationFindingsPanel(props: { ads: GrowthAdsBody }) {
  const { verification } = props.ads;
  const blocking = verification.findings.filter((finding) => finding.severity === "blocking");
  const notes = verification.findings.filter((finding) => finding.severity === "note");

  if (verification.outcome === "unreadable") {
    return (
      <DesignAlert
        variant="warning"
        description="This campaign was created, but we couldn't read your Meta account to confirm what it contains. Don't treat it as verified — open it in Ads Manager to check for yourself."
      />
    );
  }

  if (verification.outcome === "quarantine" || verification.outcome === "incomplete") {
    const isQuarantine = verification.outcome === "quarantine";
    return (
      <DesignAlert variant={isQuarantine ? "error" : "warning"}>
        <div className="flex flex-col gap-3">
          <span>
            {isQuarantine
              ? "We couldn't verify this campaign matches what you approved, so we've stopped it from going any further."
              : "The agent stopped partway through. Nothing is running or spending."}
          </span>
          {blocking.length > 0 && (
            <ul className="flex flex-col gap-2">
              {blocking.map((finding, index) => (
                <li key={`${finding.code}-${index}`} className="text-sm">
                  <span className="font-medium">{finding.message}</span>
                  {(finding.expected != null || finding.actual != null) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      {finding.expected != null && <span>Approved: {finding.expected}</span>}
                      {finding.actual != null && <span>Found in Meta: {finding.actual}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isQuarantine && (
            <Typography type="footnote">
              We paused anything that was running. Review it in Ads Manager before retrying.
            </Typography>
          )}
        </div>
      </DesignAlert>
    );
  }

  // A clean verdict with notes: real, worth surfacing, but not a blocker. Quiet and expandable rather
  // than an alert, so it does not read as an error next to a campaign that is fine.
  if (verification.outcome === "verified_with_notes" && notes.length > 0) {
    return (
      <details className="rounded-lg border border-border/60 px-3 py-2">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Verified, with {notes.length} note{notes.length === 1 ? "" : "s"}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {notes.map((finding, index) => (
            <li key={`${finding.code}-${index}`} className="text-xs text-muted-foreground">{finding.message}</li>
          ))}
        </ul>
      </details>
    );
  }

  return null;
}

/**
 * The agent's own account of what it built. Rendered under an explicit "Agent reported:" label and
 * never merged into the verified entity rows — the ids above those come only from our independent
 * read. Shown only when we have NOT verified, since after verification the observed tree is the
 * better answer and showing both would invite treating them as equivalent.
 */
function AgentReportedIds(props: { ads: GrowthAdsBody }) {
  const { ads } = props;
  const entries = Object.entries(ads.execution.agentReportedIds);
  if (entries.length === 0 || ads.verification.outcome === "verified" || ads.verification.outcome === "verified_with_notes") {
    return null;
  }
  return (
    <div className="rounded-lg border border-dashed border-border/60 px-3 py-2">
      <Typography type="footnote" variant="secondary">Agent reported (unverified):</Typography>
      <ul className="mt-1 flex flex-col gap-0.5">
        {entries.map(([key, value]) => (
          <li key={key} className="font-mono text-xs text-muted-foreground">{key}: {value}</li>
        ))}
      </ul>
    </div>
  );
}

function AdsLifecycleSection(props: { actionId: string, demo: boolean, demoAds: GrowthAdsBody | null }) {
  const { actionId, demo, demoAds } = props;
  const app = useAdminApp();
  const [state, setState] = useState<{ status: "loading" } | { status: "error", message: string } | { status: "loaded", value: GrowthAdsBody | null }>({ status: "loading" });

  // Only demo mode has a campaign lifecycle to show: activating a run_ads item creates nothing on any
  // ad platform in this build, so outside demo there is never a row to load and no route to load it
  // from. `null` renders the "no campaign has started" notice below, which is the truth.
  const load = useCallback(async () => {
    setState({ status: "loaded", value: demo ? demoAds : null });
  }, [demo, demoAds]);

  useEffect(() => {
    setState({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  // Poll only while an agent build is actually in flight. The old copy told the user to refresh by
  // hand, which is a poor answer when the thing they are waiting on is an AI working in their ad
  // account. Deliberately NOT polling in demo mode (the fixture never changes) or once the campaign
  // has settled — a paused/active/failed campaign only changes when the user acts on it.
  const isBuilding = state.status === "loaded" && state.value?.status === "creating";
  useEffect(() => {
    if (!isBuilding || demo) return;
    const timer = setInterval(() => runAsynchronously(load()), 3000);
    return () => clearInterval(timer);
  }, [isBuilding, demo, load]);

  if (state.status === "loading") return <DesignSkeleton className="h-40 w-full rounded-xl" />;
  if (state.status === "error") {
    return (
      <DesignAlert variant="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Couldn&apos;t load this campaign&apos;s status: {state.message}</span>
          <DesignButton variant="outline" size="sm" onClick={load}>Retry</DesignButton>
        </div>
      </DesignAlert>
    );
  }
  const ads = state.value;
  if (ads == null) {
    return <DesignAlert variant="default" description="This action was activated, but no campaign has started creating yet." />;
  }

  const badge = ADS_STATUS_BADGE.get(ads.status) ?? { label: ads.status, color: "blue" as const };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <DesignBadge label={badge.label} color={badge.color} size="md" />
        {ads.creationStep !== "done" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="size-3.5" /> {GROWTH_ADS_CREATION_STEP_LABELS.get(ads.creationStep) ?? ads.creationStep}
          </span>
        )}
      </div>

      {/* Above every status branch: what WE observed always outranks what the agent said, so the
          verdict is the first thing read, not a detail inside one particular state's panel. */}
      <VerificationFindingsPanel ads={ads} />
      <AgentReportedIds ads={ads} />

      {(ads.status === "rolled_back" || ads.status === "failed") && (
        <div className="flex flex-col gap-3">
          <LastErrorNotice ads={ads} />
          <OrphanedIdsNotice actionId={actionId} ads={ads} demo={demo} onChanged={load} />
        </div>
      )}

      {ads.status === "creating" && <AdsBuildProgress ads={ads} />}

      {(ads.status === "paused" || ads.status === "publishing") && (
        <CreatedPausedPanel actionId={actionId} ads={ads} demo={demo} onChanged={load} />
      )}

      {(ads.status === "active" || ads.status === "pausing") && (
        <LiveCampaignPanel actionId={actionId} ads={ads} demo={demo} onChanged={load} />
      )}

      {ads.status === "discarded" && (
        <DesignAlert variant="default" description="This campaign was discarded. Anything Meta could clean up has been removed." />
      )}
    </div>
  );
}

export function RunAdsPayloadSection(props: {
  actionId: string,
  actionStatus: string,
  payload: unknown,
  demo: boolean,
  demoAds: GrowthAdsBody | null,
  onActivated: () => Promise<void>,
}) {
  const { actionId, actionStatus, payload, demo, demoAds, onActivated } = props;
  const spec = parseAdCampaignPayload(payload);

  return (
    <DesignCard title="Meta ad campaign" subtitle="What the ads executor would run" icon={MegaphoneIcon} gradient="orange">
      <div className="flex flex-col gap-4">
        {spec == null ? (
          <DesignAlert variant="warning">
            This action has no readable campaign proposal attached yet — it will appear here once one is prepared.
          </DesignAlert>
        ) : actionStatus === "proposed" ? (
          <div className="flex flex-col gap-4">
            <CampaignDetail actionId={actionId} spec={spec} mock={false} />
            <div>
              <ActivateAdCampaignDialog actionId={actionId} spec={spec} demo={demo} onActivated={onActivated} />
            </div>
          </div>
        ) : (
          <AdsLifecycleSection actionId={actionId} demo={demo} demoAds={demoAds} />
        )}
      </div>
    </DesignCard>
  );
}
