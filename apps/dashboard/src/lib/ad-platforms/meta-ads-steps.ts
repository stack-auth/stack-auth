import type { SetupTimelineStepState } from "@/components/design-components";
import type { AdPlatformAccountDeclaration, AdPlatformStatus } from "./ad-platform-types";

/**
 * Maps a connection status onto the Meta Ads setup timeline.
 *
 * Pure — no React, no I/O — so every combination of missing prerequisites can be asserted in a unit
 * test rather than by clicking through the page. That is why the backend returns facts rather than
 * steps: the shape below changes far more often than the status contract does.
 */

export type MetaAdsSetupStepId =
  | "create-assets"
  | "connect"
  | "confirm-access";

export type MetaAdsSetupStep = {
  id: MetaAdsSetupStepId,
  title: string,
  state: SetupTimelineStepState,
};

/** Alias of the shared declaration type; the question is identical on every platform. */
export type MetaAdsAccountDeclaration = AdPlatformAccountDeclaration;

export type MetaAdsChecks = {
  hasAllScopes: boolean,
  hasAdAccount: boolean,
  hasActiveAdAccount: boolean,
  hasPaymentMethod: boolean,
  hasIdentity: boolean,
  tokenValid: boolean,
};

export function getMetaAdsChecks(status: AdPlatformStatus | null): MetaAdsChecks {
  if (status == null || !status.connected) {
    return {
      hasAllScopes: false,
      hasAdAccount: false,
      hasActiveAdAccount: false,
      hasPaymentMethod: false,
      hasIdentity: false,
      tokenValid: false,
    };
  }
  return {
    hasAllScopes: status.missingRequiredScopes.length === 0,
    hasAdAccount: status.accounts.length > 0,
    hasActiveAdAccount: status.accounts.some((account) => account.isActive),
    // Funding lives per ad account on Meta, so "has a payment method" means "at least one ad account
    // does" — that is what determines whether a campaign could actually spend.
    hasPaymentMethod: status.accounts.some((account) => account.hasFundingSource),
    hasIdentity: status.identities.length > 0,
    tokenValid: status.status !== "needs_reauth" && status.status !== "revoked",
  };
}

export function areMetaAdsChecksComplete(checks: MetaAdsChecks): boolean {
  return checks.hasAllScopes
    && checks.hasAdAccount
    && checks.hasActiveAdAccount
    && checks.hasPaymentMethod
    && checks.hasIdentity
    && checks.tokenValid;
}

/**
 * The human-readable reasons the "Confirm access" step isn't green yet, in the order the user should
 * act on them. Empty means everything checks out.
 */
export function getMetaAdsBlockers(status: AdPlatformStatus | null, checks: MetaAdsChecks): string[] {
  if (status == null || !status.connected) return [];
  const blockers: string[] = [];
  if (!checks.tokenValid) blockers.push("The connection has expired or was revoked on Meta's side. Reconnect to continue.");
  if (!checks.hasAllScopes) blockers.push(`Meta didn't grant every permission we need (${status.missingRequiredScopes.join(", ")}). Reconnect and accept all of them.`);
  if (!checks.hasAdAccount) blockers.push("No ad account was shared with us. Pick one in the Meta dialog, or create one in Business Manager first.");
  else if (!checks.hasActiveAdAccount) blockers.push("Your ad account isn't active. Meta usually shows why in Ads Manager — often an unpaid balance or a review in progress.");
  if (!checks.hasPaymentMethod) blockers.push("No payment method is on file for your ad account. Meta requires you to add one yourself.");
  if (!checks.hasIdentity) blockers.push("No Facebook Page was shared with us. Ads need a Page to run as.");
  return blockers;
}

/**
 * Build the timeline steps.
 *
 * The "Create your Meta assets" step only exists when the user has told us they don't have an
 * account yet. That answer is self-declared and stored client-side — it is a convenience that saves
 * an experienced user from reading four steps they don't need, and is never a security boundary.
 */
export function getMetaAdsSetupSteps(options: {
  status: AdPlatformStatus | null,
  declaration: MetaAdsAccountDeclaration,
  /** Set once the user clicks "I've done this" on the asset-creation step. */
  assetsAcknowledged: boolean,
}): MetaAdsSetupStep[] {
  const status = options.status;
  const connected = status?.connected === true;
  const checks = getMetaAdsChecks(status);
  const confirmed = connected && areMetaAdsChecksComplete(checks);

  const steps: MetaAdsSetupStep[] = [];

  if (options.declaration === "needs-account") {
    // Connecting proves the assets exist, so a live connection completes this step regardless of
    // whether the user ever clicked the acknowledgement.
    steps.push({
      id: "create-assets",
      title: "Create your Meta assets",
      state: options.assetsAcknowledged || connected ? "done" : "current",
    });
  }

  const assetsStepPending = options.declaration === "needs-account" && !options.assetsAcknowledged && !connected;
  steps.push({
    id: "connect",
    title: "Connect Meta Ads",
    state: connected ? "done" : (assetsStepPending ? "todo" : "current"),
  });

  steps.push({
    id: "confirm-access",
    title: "Confirm access",
    // `blocked` rather than `current` once connected but incomplete: the problem is on Meta's side,
    // so the user needs to go fix something there, not just click the next button here.
    state: !connected ? "todo" : (confirmed ? "done" : "blocked"),
  });

  return steps;
}
