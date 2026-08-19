import { describe, expect, it } from "vitest";
import type { AdPlatformAccount, AdPlatformStatus } from "./ad-platform-types";
import {
  areMetaAdsChecksComplete,
  getMetaAdsBlockers,
  getMetaAdsChecks,
  getMetaAdsSetupSteps,
  type MetaAdsSetupStep,
} from "./meta-ads-steps";

const ALL_SCOPES = [
  "ads_mcp_management", "ads_read", "ads_management",
  "catalog_management", "business_management", "pages_show_list", "instagram_basic",
];

function account(overrides: Partial<AdPlatformAccount> = {}): AdPlatformAccount {
  return {
    id: "act_1",
    name: "Acme",
    currency: "USD",
    timezone: "America/New_York",
    status: "active",
    isActive: true,
    hasFundingSource: true,
    businessId: "biz_1",
    ...overrides,
  };
}

function status(overrides: Partial<AdPlatformStatus> = {}): AdPlatformStatus {
  return {
    platform: "meta",
    configured: true,
    connected: true,
    status: "connected",
    connectedAtMillis: 1_700_000_000_000,
    displayName: "Jane",
    externalAccountId: "meta-user-1",
    accessTokenExpiresAtMillis: null,
    grantedScopes: ALL_SCOPES,
    missingRequiredScopes: [],
    accounts: [account()],
    identities: [{ id: "page_1", name: "Acme Page", kind: "page", linkedInstagram: null }],
    funding: { present: true, kind: "credit_card", displayLabel: "VISA ····4242", id: "fs_1" },
    capabilities: { canRead: true, canManage: true, canManageCatalog: true },
    warnings: [],
    lastSyncedAtMillis: 1_700_000_000_000,
    mock: false,
    ...overrides,
  };
}

const DISCONNECTED = status({
  connected: false,
  status: null,
  connectedAtMillis: null,
  displayName: null,
  externalAccountId: null,
  grantedScopes: [],
  missingRequiredScopes: ALL_SCOPES,
  accounts: [],
  identities: [],
  funding: null,
  capabilities: { canRead: false, canManage: false, canManageCatalog: false },
});

/** Invariants every generated timeline must satisfy, regardless of the input. */
function assertTimelineInvariants(steps: MetaAdsSetupStep[]) {
  expect(steps.length).toBeGreaterThan(0);
  // At most one step is highlighted as "do this next" — two would leave the user unsure where to look.
  expect(steps.filter((step) => step.state === "current").length).toBeLessThanOrEqual(1);
  // Progress reads top-to-bottom: nothing may be done after something that hasn't started.
  const firstUnfinished = steps.findIndex((step) => step.state !== "done");
  if (firstUnfinished >= 0) {
    expect(steps.slice(firstUnfinished).every((step) => step.state !== "done")).toBe(true);
  }
  expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
}

describe("getMetaAdsChecks", () => {
  it("reports everything false when there is no connection", () => {
    expect(getMetaAdsChecks(null)).toEqual({
      hasAllScopes: false, hasAdAccount: false, hasActiveAdAccount: false,
      hasPaymentMethod: false, hasIdentity: false, tokenValid: false,
    });
    expect(getMetaAdsChecks(DISCONNECTED).hasAdAccount).toBe(false);
  });

  it("passes every check for a fully healthy connection", () => {
    expect(areMetaAdsChecksComplete(getMetaAdsChecks(status()))).toBe(true);
  });

  it("distinguishes 'has an ad account' from 'has an active one'", () => {
    const checks = getMetaAdsChecks(status({ accounts: [account({ isActive: false, status: "unsettled" })] }));
    expect(checks.hasAdAccount).toBe(true);
    expect(checks.hasActiveAdAccount).toBe(false);
    expect(areMetaAdsChecksComplete(checks)).toBe(false);
  });

  it("treats funding as present when ANY ad account has it, since that's what lets a campaign spend", () => {
    const checks = getMetaAdsChecks(status({
      accounts: [account({ id: "act_1", hasFundingSource: false }), account({ id: "act_2", hasFundingSource: true })],
    }));
    expect(checks.hasPaymentMethod).toBe(true);
  });

  it("fails the payment check when no account has funding", () => {
    expect(getMetaAdsChecks(status({ accounts: [account({ hasFundingSource: false })] })).hasPaymentMethod).toBe(false);
  });

  it("marks the token invalid when the connection needs re-auth or was revoked", () => {
    expect(getMetaAdsChecks(status({ status: "needs_reauth" })).tokenValid).toBe(false);
    expect(getMetaAdsChecks(status({ status: "revoked" })).tokenValid).toBe(false);
  });

  it("fails the scope check on a partial grant", () => {
    expect(getMetaAdsChecks(status({ grantedScopes: ["ads_read"], missingRequiredScopes: ["ads_management"] })).hasAllScopes).toBe(false);
  });
});

describe("getMetaAdsBlockers", () => {
  it("is empty for a healthy connection", () => {
    const value = status();
    expect(getMetaAdsBlockers(value, getMetaAdsChecks(value))).toEqual([]);
  });

  it("is empty when disconnected — there is nothing to fix until the user connects", () => {
    expect(getMetaAdsBlockers(DISCONNECTED, getMetaAdsChecks(DISCONNECTED))).toEqual([]);
    expect(getMetaAdsBlockers(null, getMetaAdsChecks(null))).toEqual([]);
  });

  it("names the missing scopes so the user knows what to accept on the retry", () => {
    const value = status({ grantedScopes: ["ads_read"], missingRequiredScopes: ["ads_management", "pages_show_list"] });
    const blockers = getMetaAdsBlockers(value, getMetaAdsChecks(value));
    expect(blockers.some((blocker) => blocker.includes("ads_management"))).toBe(true);
  });

  it("says 'no ad account' rather than 'not active' when there are none at all", () => {
    const value = status({ accounts: [] });
    const blockers = getMetaAdsBlockers(value, getMetaAdsChecks(value));
    expect(blockers.some((blocker) => blocker.includes("No ad account"))).toBe(true);
    expect(blockers.some((blocker) => blocker.includes("isn't active"))).toBe(false);
  });

  it("says 'not active' when an account exists but is unhealthy", () => {
    const value = status({ accounts: [account({ isActive: false, status: "unsettled" })] });
    expect(getMetaAdsBlockers(value, getMetaAdsChecks(value)).some((blocker) => blocker.includes("isn't active"))).toBe(true);
  });

  it("leads with the expired-connection blocker, since nothing else can be fixed until it's resolved", () => {
    const value = status({ status: "needs_reauth" });
    expect(getMetaAdsBlockers(value, getMetaAdsChecks(value))[0]).toMatch(/expired or was revoked/);
  });

  it("reports the missing Page", () => {
    const value = status({ identities: [] });
    expect(getMetaAdsBlockers(value, getMetaAdsChecks(value)).some((blocker) => blocker.includes("Page"))).toBe(true);
  });
});

describe("getMetaAdsSetupSteps", () => {
  it("hides the asset-creation step until the user says they need it", () => {
    for (const declaration of ["unanswered", "has-account"] as const) {
      const steps = getMetaAdsSetupSteps({ status: DISCONNECTED, declaration, assetsAcknowledged: false });
      expect(steps.map((step) => step.id)).toEqual(["connect", "confirm-access"]);
      assertTimelineInvariants(steps);
    }
  });

  it("shows the asset-creation step first when the user says they have no account", () => {
    const steps = getMetaAdsSetupSteps({ status: DISCONNECTED, declaration: "needs-account", assetsAcknowledged: false });
    expect(steps.map((step) => step.id)).toEqual(["create-assets", "connect", "confirm-access"]);
    expect(steps[0].state).toBe("current");
    // Connect stays greyed until the assets exist, so the user doesn't start a flow that can't succeed.
    expect(steps[1].state).toBe("todo");
    assertTimelineInvariants(steps);
  });

  it("advances to Connect once the user acknowledges creating their assets", () => {
    const steps = getMetaAdsSetupSteps({ status: DISCONNECTED, declaration: "needs-account", assetsAcknowledged: true });
    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("current");
    assertTimelineInvariants(steps);
  });

  it("completes the asset step from a live connection even if it was never acknowledged", () => {
    // Connecting is proof the assets exist, so requiring the click too would strand the user on a
    // step they've provably already completed.
    const steps = getMetaAdsSetupSteps({ status: status(), declaration: "needs-account", assetsAcknowledged: false });
    expect(steps[0].state).toBe("done");
    assertTimelineInvariants(steps);
  });

  it("marks every step done for a fully healthy connection", () => {
    const steps = getMetaAdsSetupSteps({ status: status(), declaration: "has-account", assetsAcknowledged: false });
    expect(steps.every((step) => step.state === "done")).toBe(true);
    assertTimelineInvariants(steps);
  });

  it.each([
    ["a partial scope grant", status({ grantedScopes: ["ads_read"], missingRequiredScopes: ["ads_management"] })],
    ["no ad account", status({ accounts: [] })],
    ["an unsettled ad account", status({ accounts: [account({ isActive: false, status: "unsettled" })] })],
    ["no payment method", status({ accounts: [account({ hasFundingSource: false })] })],
    ["no Facebook Page", status({ identities: [] })],
    ["an expired token", status({ status: "needs_reauth" })],
  ])("blocks the confirm step for %s", (_label, value) => {
    const steps = getMetaAdsSetupSteps({ status: value, declaration: "has-account", assetsAcknowledged: false });
    const confirm = steps.find((step) => step.id === "confirm-access");
    // `blocked`, not `current`: the fix lives on Meta's side, so there is no button here to press.
    expect(confirm?.state).toBe("blocked");
    expect(steps.find((step) => step.id === "connect")?.state).toBe("done");
    expect(getMetaAdsBlockers(value, getMetaAdsChecks(value)).length).toBeGreaterThan(0);
    assertTimelineInvariants(steps);
  });

  it("treats a null status the same as disconnected", () => {
    const steps = getMetaAdsSetupSteps({ status: null, declaration: "has-account", assetsAcknowledged: false });
    expect(steps.find((step) => step.id === "connect")?.state).toBe("current");
    expect(steps.find((step) => step.id === "confirm-access")?.state).toBe("todo");
    assertTimelineInvariants(steps);
  });
});
