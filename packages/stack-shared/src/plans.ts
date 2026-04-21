/**
 * Plan configuration for Stack Auth pricing tiers.
 *
 * This file defines the limits for each plan and the item IDs used to track them.
 * Import these constants in seed.ts and backend code for limit enforcement.
 */

export const UNLIMITED = 1_000_000_000;

/**
 * Item IDs used across the codebase for tracking plan limits.
 */
export const ITEM_IDS = {
  seats: "dashboard_admins",
  authUsers: "auth_users",
  emailsPerMonth: "emails_per_month",
  analyticsTimeoutSeconds: "analytics_timeout_seconds",
  analyticsEvents: "analytics_events",
  sessionReplays: "session_replays",
  onboardingCall: "onboarding_call",
} as const;

export type ItemId = typeof ITEM_IDS[keyof typeof ITEM_IDS];

/**
 * The offerings/limits included in a plan.
 */
export type PlanProductOfferings = {
  seats: number,
  authUsers: number,
  emailsPerMonth: number,
  analyticsTimeoutSeconds: number,
  analyticsEvents: number,
  sessionReplays: number,
};

/**
 * Plan limits by plan ID.
 */
export const PLAN_LIMITS: {
  free: PlanProductOfferings,
  team: PlanProductOfferings,
  growth: PlanProductOfferings,
} = {
  free: {
    seats: 1,
    authUsers: 10_000,
    emailsPerMonth: 1_000,
    analyticsTimeoutSeconds: 10,
    analyticsEvents: 100_000,
    sessionReplays: 2_500,
  },
  team: {
    seats: 4,
    authUsers: 50_000,
    emailsPerMonth: 25_000,
    analyticsTimeoutSeconds: 60,
    analyticsEvents: 500_000,
    sessionReplays: 2_500,
  },
  growth: {
    seats: 4,
    authUsers: UNLIMITED,
    emailsPerMonth: 25_000,
    analyticsTimeoutSeconds: 300,
    analyticsEvents: 1_000_000,
    sessionReplays: 2_500,
  },
};

export type PlanId = keyof typeof PLAN_LIMITS;

/**
 * Base plan IDs ordered from highest to lowest tier. Use this (instead of
 * string literals) whenever code needs to pick a customer's "current" plan
 * from their product list, so the choice stays in sync with `PLAN_LIMITS`.
 */
export const BASE_PLAN_IDS_BY_TIER = ["growth", "team", "free"] as const satisfies readonly PlanId[];
