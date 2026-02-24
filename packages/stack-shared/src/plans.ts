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
  },
  team: {
    seats: 4,
    authUsers: 50_000,
    emailsPerMonth: 25_000,
    analyticsTimeoutSeconds: 60,
    analyticsEvents: 500_000,
  },
  growth: {
    seats: UNLIMITED,
    authUsers: UNLIMITED,
    emailsPerMonth: 25_000,
    analyticsTimeoutSeconds: 300,
    analyticsEvents: 1_000_000,
  },
};

export type PlanId = keyof typeof PLAN_LIMITS;
