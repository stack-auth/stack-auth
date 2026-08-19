import type {
  AdPlatformDisconnectResult,
  AdPlatformId,
  AdPlatformStatus,
  AdPlatformWarning,
} from "./ad-platform-types";

/**
 * Ad-platform client for a build with NO ad platform integration behind it.
 *
 * There is no `/internal/ad-platforms` backend surface yet: no OAuth, no stored connection, no Graph
 * reads. Rather than leave the pages dead, this module simulates a connection entirely in the
 * browser so the Growth workspace's ads flow is navigable and reviewable end to end — clicking
 * "Connect" marks the platform connected for this project, and the connected views render fixed
 * sample figures.
 *
 * TWO RULES this module exists to keep, and that the real client must inherit when it replaces it:
 *
 * 1. NOTHING HERE IS THE CUSTOMER'S DATA, and the UI must never imply otherwise. Every status this
 *    returns carries `mock: true`, and the pages key their "Sample data" labelling off that flag.
 *    Fabricated ad spend presented as a real account's numbers is the single worst failure mode this
 *    surface has — a customer would make budget decisions on invented figures.
 * 2. Nothing here reaches an ad platform, so nothing here can spend money. The simulated connection
 *    grants no capability; `canManage` is false precisely because there is nothing to manage.
 *
 * State lives in `localStorage` rather than component state so the connection survives a reload (a
 * demo that forgets on refresh is worse than no demo), and is keyed per project so switching
 * projects doesn't inherit another one's simulated connection.
 */

const STORAGE_KEY_PREFIX = "hexclave.growth.ad-platform-preview.";

/** Fixed so every render, reload, and screenshot shows the same numbers. */
const SAMPLE_CONNECTED_AT_MILLIS = new Date("2026-08-02T09:15:00.000Z").getTime();

export class AdPlatformApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "AdPlatformApiError";
  }
}

function storageKey(projectId: string, platform: AdPlatformId): string {
  return `${STORAGE_KEY_PREFIX}${projectId}.${platform}`;
}

/**
 * Reads the simulated connection flag. Returns false rather than throwing when `localStorage` is
 * unavailable (server render, or a browser with storage disabled): "not connected" is the safe
 * reading of "we cannot tell", since it shows the setup flow rather than sample numbers.
 */
function readConnected(projectId: string, platform: AdPlatformId): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(storageKey(projectId, platform)) === "connected";
}

function writeConnected(projectId: string, platform: AdPlatformId, connected: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (connected) {
    localStorage.setItem(storageKey(projectId, platform), "connected");
  } else {
    localStorage.removeItem(storageKey(projectId, platform));
  }
}

const PREVIEW_WARNING: AdPlatformWarning = {
  code: "preview_connection",
  message: "This is a preview of the Meta Ads integration. Nothing is connected to Meta, and the accounts and figures shown here are sample data, not your account's.",
};

function disconnectedStatus(platform: AdPlatformId): AdPlatformStatus {
  return {
    platform,
    // `configured: true` so the page offers the connect flow rather than the operator-error state
    // ("no credentials on this deployment"), which would be a misleading diagnosis: there is no
    // credential to configure yet because there is no integration.
    configured: true,
    connected: false,
    status: null,
    connectedAtMillis: null,
    displayName: null,
    externalAccountId: null,
    accessTokenExpiresAtMillis: null,
    grantedScopes: [],
    missingRequiredScopes: [],
    accounts: [],
    identities: [],
    funding: null,
    capabilities: { canRead: false, canManage: false, canManageCatalog: false },
    warnings: [PREVIEW_WARNING],
    lastSyncedAtMillis: null,
    mock: true,
  };
}

function connectedStatus(platform: AdPlatformId): AdPlatformStatus {
  return {
    platform,
    configured: true,
    connected: true,
    status: "connected",
    connectedAtMillis: SAMPLE_CONNECTED_AT_MILLIS,
    displayName: "Sample Business (preview)",
    externalAccountId: "act_0000000000",
    // No credential exists, so nothing expires.
    accessTokenExpiresAtMillis: null,
    grantedScopes: ["ads_read"],
    missingRequiredScopes: [],
    accounts: [{
      id: "act_0000000000",
      name: "Sample ad account (preview)",
      currency: "USD",
      timezone: "America/New_York",
      status: "active",
      isActive: true,
      hasFundingSource: true,
      businessId: "0000000000",
    }],
    identities: [{
      id: "0000000001",
      name: "Sample Page (preview)",
      kind: "page",
      linkedInstagram: null,
    }],
    funding: { present: true, kind: "card", displayLabel: "Sample card (preview)", id: null },
    // canRead is true so the connected views render; canManage is false because there is genuinely
    // nothing this connection could manage.
    capabilities: { canRead: true, canManage: false, canManageCatalog: false },
    warnings: [PREVIEW_WARNING],
    lastSyncedAtMillis: SAMPLE_CONNECTED_AT_MILLIS,
    mock: true,
  };
}

export async function fetchAdPlatformStatus(projectId: string, platform: AdPlatformId): Promise<AdPlatformStatus> {
  return readConnected(projectId, platform) ? connectedStatus(platform) : disconnectedStatus(platform);
}

/**
 * Marks the platform connected for this project and returns the resulting status.
 *
 * Deliberately NOT the real client's shape: that one returns an authorization URL for the caller to
 * navigate to, because connecting means an OAuth round trip through the platform's consent dialog.
 * There is no such round trip here, and returning a fake URL for a page to navigate to would be a
 * strictly worse lie than this honest signature. The page therefore has no consent-tab handling —
 * that comes back with the real client.
 */
export async function connectAdPlatform(projectId: string, platform: AdPlatformId): Promise<AdPlatformStatus> {
  writeConnected(projectId, platform, true);
  return connectedStatus(platform);
}

export async function disconnectAdPlatform(projectId: string, platform: AdPlatformId): Promise<AdPlatformDisconnectResult> {
  const wasConnected = readConnected(projectId, platform);
  writeConnected(projectId, platform, false);
  return {
    disconnected: true,
    // Nothing was granted remotely, so there is nothing to revoke — reporting `true` keeps the page
    // from warning the user to go clean up a Meta grant that never existed.
    revokedRemotely: true,
    alreadyDisconnected: !wasConnected,
  };
}

// -------------------------------------------------- insights (spend/impressions/clicks) --------------------------------------------------

export type AdPlatformInsightsAction = {
  actionType: string,
  count: number,
  valueMinor: number | null,
  costPerActionMinor: number | null,
};

export type AdPlatformInsightsRow = {
  objectId: string,
  objectName: string | null,
  date: string | null,
  spendMinor: number,
  impressions: number,
  clicks: number,
  ctr: number | null,
  cpcMinor: number | null,
  reach: number | null,
  frequency: number | null,
  actions: AdPlatformInsightsAction[],
};

export type AdPlatformInsightsResult = {
  rows: AdPlatformInsightsRow[],
  truncated: boolean,
  warnings: AdPlatformWarning[],
  servedFromCache: boolean,
  stale: boolean,
};

/**
 * SAMPLE ad performance for a campaign, in the shape the real insights read will return.
 *
 * Fixed values, not randomised: a panel whose numbers drift between renders reads as live data,
 * which is the exact impression this must not give. The `preview_connection` warning rides along on
 * every result so the panel can label the figures at the point they are shown.
 */
export async function fetchAdPlatformInsights(projectId: string, platform: AdPlatformId, options: {
  accountId: string,
  level: "account" | "campaign" | "adset" | "ad",
  objectIds?: string[],
  since: string,
  until: string,
  timeIncrement: "all" | "daily",
}): Promise<AdPlatformInsightsResult> {
  if (!readConnected(projectId, platform)) {
    throw new AdPlatformApiError(404, "No ad platform connection for this project.");
  }
  const objectId = options.objectIds?.[0] ?? options.accountId;
  return {
    rows: [{
      objectId,
      objectName: "Sample campaign (preview)",
      // null rather than a date: this is the "all" aggregate, and inventing per-day rows would
      // invite the panel to draw a trend line out of numbers that describe nothing.
      date: null,
      spendMinor: 4250,
      impressions: 18420,
      clicks: 236,
      ctr: 1.28,
      cpcMinor: 18,
      reach: 14110,
      frequency: 1.31,
      actions: [{ actionType: "lead", count: 12, valueMinor: null, costPerActionMinor: 354 }],
    }],
    truncated: false,
    warnings: [PREVIEW_WARNING],
    servedFromCache: false,
    stale: false,
  };
}
