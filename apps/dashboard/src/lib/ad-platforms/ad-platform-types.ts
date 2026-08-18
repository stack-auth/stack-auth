/**
 * Dashboard-side domain types for ad-platform connections.
 *
 * These mirror the backend's normalized types but in camelCase; the snake_case wire format is
 * confined to ad-platforms-api.ts, the same split the Growth module uses (lib/growth/growth-types.ts
 * vs growth-api.ts).
 */

export const AD_PLATFORM_IDS = ["meta", "google", "x", "tiktok"] as const;
export type AdPlatformId = typeof AD_PLATFORM_IDS[number];

export const AD_PLATFORM_CONNECTION_STATUSES = ["connected", "needs_reauth", "revoked"] as const;
export type AdPlatformConnectionStatus = typeof AD_PLATFORM_CONNECTION_STATUSES[number];

export const AD_PLATFORM_ACCOUNT_STATUS_FLAGS = [
  "active", "disabled", "unsettled", "pending", "closed", "unknown",
] as const;
export type AdPlatformAccountStatusFlag = typeof AD_PLATFORM_ACCOUNT_STATUS_FLAGS[number];

export type AdPlatformAccount = {
  id: string,
  name: string,
  currency: string | null,
  timezone: string | null,
  status: AdPlatformAccountStatusFlag,
  isActive: boolean,
  hasFundingSource: boolean,
  businessId: string | null,
};

export type AdPlatformIdentity = {
  id: string,
  name: string,
  kind: "page" | "instagram" | "handle" | "profile",
  linkedInstagram: { id: string, username: string } | null,
};

export type AdPlatformFundingSource = {
  present: boolean,
  kind: string | null,
  displayLabel: string | null,
  id: string | null,
};

/**
 * The user's self-declared answer to "do you already have an account on this platform?".
 *
 * Shared across platforms because it is the same question everywhere — only the assets it implies
 * differ, and that lives in each platform's step builder.
 */
export type AdPlatformAccountDeclaration = "unanswered" | "has-account" | "needs-account";

export type AdPlatformWarning = {
  code: string,
  message: string,
};

export type AdPlatformStatus = {
  platform: AdPlatformId,
  /** Whether this deployment has credentials for the platform at all. */
  configured: boolean,
  connected: boolean,
  status: AdPlatformConnectionStatus | null,
  connectedAtMillis: number | null,
  displayName: string | null,
  externalAccountId: string | null,
  /** null means the credential does not expire (e.g. a Meta system-user token). */
  accessTokenExpiresAtMillis: number | null,
  grantedScopes: string[],
  missingRequiredScopes: string[],
  accounts: AdPlatformAccount[],
  identities: AdPlatformIdentity[],
  funding: AdPlatformFundingSource | null,
  capabilities: { canRead: boolean, canManage: boolean, canManageCatalog: boolean },
  warnings: AdPlatformWarning[],
  lastSyncedAtMillis: number | null,
  /** True when the backend is running the built-in simulator rather than the real platform. */
  mock: boolean,
};

export type AdPlatformConnectStart = {
  authorizationUrl: string,
  state: string,
  expiresAtMillis: number,
};

export type AdPlatformDisconnectResult = {
  disconnected: boolean,
  revokedRemotely: boolean,
  alreadyDisconnected: boolean,
};
