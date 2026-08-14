"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignSkeleton,
  SetupTimeline,
  type SetupTimelineStep,
} from "@/components/design-components";
import { useRouter } from "@/components/router";
import { Typography } from "@/components/ui";
import { useAdPlatformDeclaration } from "@/lib/ad-platforms/ad-platform-declaration";
import type { AdPlatformAccountStatusFlag, AdPlatformStatus } from "@/lib/ad-platforms/ad-platform-types";
import { connectAdPlatform, disconnectAdPlatform } from "@/lib/ad-platforms/ad-platforms-api";
import {
  getMetaAdsBlockers,
  getMetaAdsChecks,
  getMetaAdsSetupSteps,
  type MetaAdsSetupStep,
} from "@/lib/ad-platforms/meta-ads-steps";
import { useAdPlatformStatus } from "@/lib/ad-platforms/use-ad-platform-status";
import { ArrowSquareOutIcon, CreditCardIcon, FlagIcon, PlugsConnectedIcon, QuestionIcon } from "@phosphor-icons/react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import { GrowthAppFrame } from "../components/frame";

/**
 * The four things only the user can do, because Meta exposes no API for any of them: creating a
 * Business Manager, a Page, or an ad account, and adding a payment method. Being upfront about that
 * is the honest framing for this whole page — the goal is once-touch setup, not zero-touch.
 */
const META_ASSET_LINKS = [
  { label: "Create a Business Manager", href: "https://business.facebook.com/" },
  { label: "Create a Facebook Page", href: "https://www.facebook.com/pages/create" },
  { label: "Create an ad account", href: "https://business.facebook.com/settings/ad-accounts" },
  { label: "Add a payment method", href: "https://www.facebook.com/ads/manager/account_settings/account_billing/" },
] as const;

const ACCOUNT_STATUS_COLORS: Record<AdPlatformAccountStatusFlag, "green" | "red" | "orange" | "blue"> = {
  active: "green",
  disabled: "red",
  unsettled: "orange",
  pending: "orange",
  closed: "red",
  unknown: "blue",
};

/** Short machine codes from the callback redirect, turned into something a user can act on. */
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Meta permission request, so nothing was connected. You can start again whenever you're ready.",
  invalid_state: "That connection link was invalid or had already been used. Please start the connection again.",
  exchange_failed: "Meta didn't complete the connection. Please try again — if it keeps happening, check that your Meta app is fully set up.",
  platform_unavailable: "Meta Ads isn't configured on this deployment yet.",
};

/** Query params the Meta OAuth callback redirect appends. Stripped after being consumed, below. */
const CALLBACK_PARAM_NAMES = ["error", "connected", "warning", "ads_platform"] as const;

function ExternalLink(props: { href: string, label: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2 transition-colors hover:transition-none hover:text-foreground"
    >
      {props.label}
      <ArrowSquareOutIcon className="h-3.5 w-3.5" />
    </a>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <DesignSkeleton className="h-24 w-full rounded-2xl" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-10">
          <DesignSkeleton className="h-5 w-[160px]" />
          <DesignSkeleton className="h-16 flex-1 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function ConnectionSummary(props: { status: AdPlatformStatus }) {
  const status = props.status;
  const expiry = status.accessTokenExpiresAtMillis;

  return (
    <div className="flex flex-col gap-4">
      <DesignCard title="Connection" icon={PlugsConnectedIcon}>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Typography variant="secondary">Connected as</Typography>
            <Typography className="font-medium">{status.displayName ?? status.externalAccountId ?? "Unknown"}</Typography>
            {status.mock && <DesignBadge label="Mock" color="purple" size="sm" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Typography variant="secondary">Access</Typography>
            <Typography>
              {/* A null expiry is not "unknown" — it is Meta telling us the credential never
                  expires, which is the outcome we want and worth naming explicitly. */}
              {expiry == null ? "Long-lived (no expiry)" : `Expires ${new Date(expiry).toLocaleDateString()}`}
            </Typography>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Typography variant="secondary">Permissions</Typography>
            {status.grantedScopes.length === 0
              ? <Typography>None reported</Typography>
              : status.grantedScopes.map((scope) => <DesignBadge key={scope} label={scope} color="blue" size="sm" />)}
          </div>
        </div>
      </DesignCard>

      <DesignCard title="Ad accounts" icon={CreditCardIcon}>
        {status.accounts.length === 0 ? (
          <Typography variant="secondary">No ad account was shared with us.</Typography>
        ) : (
          <div className="flex flex-col gap-3">
            {status.accounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center gap-2">
                <Typography className="font-medium">{account.name}</Typography>
                <Typography variant="secondary" type="footnote">{account.id}</Typography>
                <DesignBadge label={account.status} color={ACCOUNT_STATUS_COLORS[account.status]} size="sm" />
                <DesignBadge
                  label={account.hasFundingSource ? "Payment method on file" : "No payment method"}
                  color={account.hasFundingSource ? "green" : "orange"}
                  size="sm"
                />
                {account.currency != null && <Typography variant="secondary" type="footnote">{account.currency}</Typography>}
              </div>
            ))}
          </div>
        )}
      </DesignCard>

      <DesignCard title="Pages" icon={FlagIcon}>
        {status.identities.length === 0 ? (
          <Typography variant="secondary">No Facebook Page was shared with us. Ads need a Page to run as.</Typography>
        ) : (
          <div className="flex flex-col gap-2">
            {status.identities.map((identity) => (
              <div key={identity.id} className="flex flex-wrap items-center gap-2">
                <Typography className="font-medium">{identity.name}</Typography>
                {identity.linkedInstagram != null && (
                  <DesignBadge label={`@${identity.linkedInstagram.username}`} color="purple" size="sm" />
                )}
              </div>
            ))}
          </div>
        )}
      </DesignCard>
    </div>
  );
}

function AdAccountsContent() {
  const app = useAdminApp();
  const projectId = useProjectId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { state, refresh } = useAdPlatformStatus(projectId, "meta");
  const { declaration, setDeclaration, assetsAcknowledged, acknowledgeAssets } = useAdPlatformDeclaration("meta", projectId);

  // Captured into state so that stripping the query params below doesn't also erase the message
  // we're trying to show.
  const [callbackResult, setCallbackResult] = useState<{ kind: "success" | "warning" | "error", message: string } | null>(null);

  // Consent now happens in a second tab, so the connection can land while this tab is in the
  // background — and a page still showing "Connect Meta Ads" after the user just connected reads as
  // the flow having failed. Re-reading on focus is what closes that gap. Uncached (`force`) because
  // the status read is cached per connection and the whole point here is to see a change that just
  // happened; it fires only on an actual tab switch, so it is not a poll.
  useEffect(() => {
    const onFocus = () => runAsynchronously(refresh({ force: true }));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Two things make this effect need a guard rather than a plain dependency array:
  //   - our `useRouter` returns a fresh object every render, so it can never be a stable dependency;
  //   - `router.replace()` doesn't clear the query string synchronously, so the params are still
  //     present on the next render.
  // Together those would re-run the effect, re-set the state, and loop forever. The ref makes
  // consuming the callback params a strictly one-time action, which is what it actually is.
  const hasConsumedCallbackParams = useRef(false);
  useEffect(() => {
    if (hasConsumedCallbackParams.current) return;

    const error = searchParams.get("error");
    const connected = searchParams.get("connected");
    const warning = searchParams.get("warning");
    if (error == null && connected == null) return;

    hasConsumedCallbackParams.current = true;

    if (error != null) {
      setCallbackResult({
        kind: "error",
        message: CALLBACK_ERROR_MESSAGES[error] ?? "We couldn't complete the connection. Please try again.",
      });
    } else if (warning === "missing_scopes") {
      setCallbackResult({
        kind: "warning",
        message: "Connected, but Meta didn't grant every permission we asked for. Reconnect and accept all of them to unlock everything below.",
      });
    } else {
      setCallbackResult({ kind: "success", message: "Meta Ads is connected." });
    }

    // Strip only the OAuth callback's own params, not the whole query string: Growth's demo mode
    // (`?demo=…&demoPhase=…`, see lib/growth/growth-mode.ts) also lives in the query string, and a
    // customer never sees it, but the `internal` project uses it to preview every lifecycle state.
    // A bare `router.replace(pathname)` would silently drop that session back to live data on the
    // very page an operator is using to demo the connect flow.
    const next = new URLSearchParams(searchParams.toString());
    for (const name of CALLBACK_PARAM_NAMES) next.delete(name);
    const query = next.toString();
    router.replace(query.length === 0 ? pathname : `${pathname}?${query}`);
  }, [searchParams, router, pathname]);

  const status = state.status === "loaded" ? state.value : null;
  const checks = getMetaAdsChecks(status);
  const blockers = getMetaAdsBlockers(status, checks);
  const stepStates = getMetaAdsSetupSteps({ status, declaration, assetsAcknowledged });

  // No consent tab and no redirect: this build has no ad platform integration, so "connecting" marks
  // the platform connected locally and shows the sample workspace (see lib/ad-platforms/
  // ad-platforms-api.ts). The real flow — open a tab on the click's user activation, then point it at
  // the platform's consent dialog — returns with that integration.
  const connect = async () => {
    await connectAdPlatform(projectId, "meta");
    setCallbackResult({
      kind: "warning",
      message: "This is a preview of the Meta Ads integration — nothing is connected to Meta. The accounts and figures below are sample data, not your account's.",
    });
    await refresh({ force: true });
  };

  const disconnect = async () => {
    await disconnectAdPlatform(projectId, "meta");
    setCallbackResult(null);
    await refresh({ force: true });
  };

  const contentFor = (step: MetaAdsSetupStep): SetupTimelineStep => {
    switch (step.id) {
      case "create-assets": {
        return {
          ...step,
          description: "Only you can do these — Meta has no API for them.",
          content: (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                {META_ASSET_LINKS.map((link) => <ExternalLink key={link.href} href={link.href} label={link.label} />)}
              </div>
              <Typography variant="secondary" type="footnote">
                Meta requires business verification and runs its own payment and fraud checks, so none of
                these can be created on your behalf. It takes about 15 minutes, and you only do it once.
              </Typography>
            </div>
          ),
          action: step.state === "done" ? undefined : {
            label: "I've done this",
            variant: "secondary",
            onClick: acknowledgeAssets,
          },
        };
      }
      case "connect": {
        return {
          ...step,
          description: "One click. We never see your Meta password.",
          content: step.state === "done" && status != null
            ? <Typography variant="secondary">Connected as {status.displayName ?? status.externalAccountId}.</Typography>
            : <Typography variant="secondary">You&apos;ll pick which ad account and Page to share in Meta&apos;s dialog.</Typography>,
          action: step.state === "done"
            ? { label: "Reconnect", variant: "secondary", onClick: connect }
            : { label: "Connect Meta Ads", onClick: connect },
        };
      }
      case "confirm-access": {
        return {
          ...step,
          description: "What Meta actually gave us.",
          content: status == null || !status.connected ? (
            <Typography variant="secondary">Available once you&apos;ve connected.</Typography>
          ) : blockers.length === 0 ? (
            <Typography variant="secondary">
              Everything checks out. You won&apos;t need to open Ads Manager again.
            </Typography>
          ) : (
            <ul className="flex list-disc flex-col gap-1.5 ps-4">
              {blockers.map((blocker) => (
                <li key={blocker}><Typography type="footnote">{blocker}</Typography></li>
              ))}
            </ul>
          ),
        };
      }
    }
  };

  return (
    <PageLayout
      title="Ad accounts"
      description="Connect your Meta advertising account once, then manage everything from here."
      actions={status?.connected === true
        ? <DesignButton variant="secondary" onClick={disconnect}>Disconnect</DesignButton>
        : undefined}
    >
      <div className="flex flex-col gap-6">
        {callbackResult != null && (
          <DesignAlert
            variant={callbackResult.kind === "success" ? "success" : callbackResult.kind === "warning" ? "warning" : "error"}
            description={callbackResult.message}
          />
        )}

        {/* Blocking problems get an alert, never a toast — a toast for "your connection is dead" is
            too easy to miss on a page the user visits rarely. */}
        {state.status === "error" && (
          <DesignAlert
            variant="error"
            title="Couldn't load your Meta Ads connection"
            description={
              <div className="flex flex-col items-start gap-3">
                <span>{state.message}</span>
                <DesignButton variant="secondary" onClick={() => refresh()}>Try again</DesignButton>
              </div>
            }
          />
        )}

        {state.status === "loading" && <LoadingState />}

        {/* Told up front, not discovered by clicking a button that was never going to work. This is
            a deployment setup gap, so it's addressed to whoever operates the deployment. */}
        {state.status === "loaded" && !state.value.configured && (
          <DesignAlert
            variant="warning"
            title="Meta Ads isn't configured on this deployment"
            description={
              <span>
                Connecting requires a registered Meta app: its id identifies Hexclave to Meta, and its
                secret is what proves the request is ours when we exchange your authorization for a
                token. Neither is anything you provide — an operator sets them once per deployment.
                {" "}Missing: <code>HEXCLAVE_META_ADS_CLIENT_ID</code> and <code>HEXCLAVE_META_ADS_CLIENT_SECRET</code>.
              </span>
            }
          />
        )}

        {state.status === "loaded" && (
          <>
            {/* The gate is a convenience, not a security boundary: it only decides whether we show
                four steps the user may not need. It disappears once connected, since a live
                connection answers the question definitively. */}
            {declaration === "unanswered" && !state.value.connected && (
              <DesignCard title="Do you already have a Meta Ads account?" icon={QuestionIcon}>
                <div className="flex flex-col gap-3">
                  <Typography variant="secondary">
                    If you don&apos;t, we&apos;ll show you exactly what to create first.
                  </Typography>
                  <div className="flex gap-2">
                    <DesignButton onClick={() => setDeclaration("has-account")}>Yes, I have one</DesignButton>
                    <DesignButton variant="secondary" onClick={() => setDeclaration("needs-account")}>No, not yet</DesignButton>
                  </div>
                </div>
              </DesignCard>
            )}

            <SetupTimeline steps={stepStates.map(contentFor)} />

            {state.value.connected && <ConnectionSummary status={state.value} />}
          </>
        )}
      </div>
    </PageLayout>
  );
}

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <AdAccountsContent />
    </GrowthAppFrame>
  );
}
