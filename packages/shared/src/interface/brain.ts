/**
 * Shared Brain constants and types used by backend + dashboard.
 *
 * The Brain is a single persistent AI conversation per tenancy/environment
 * with a durable incoming event queue. While the queue is non-empty, a
 * background worker keeps waking the Brain to process items.
 */

export const BRAIN_EVENT_PAYLOAD_MAX_BYTES = 256 * 1024;

export const BRAIN_QUEUE_ITEM_STATUSES = [
  "QUEUED",
  "CLAIMED",
  "COMPLETED",
  "FAILED",
] as const;
export type BrainQueueItemStatus = typeof BRAIN_QUEUE_ITEM_STATUSES[number];

export const BRAIN_MESSAGE_VISIBILITIES = ["visible", "hidden"] as const;
export type BrainMessageVisibility = typeof BRAIN_MESSAGE_VISIBILITIES[number];

export const BRAIN_MESSAGE_ROLES = ["user", "assistant", "tool", "system"] as const;
export type BrainMessageRole = typeof BRAIN_MESSAGE_ROLES[number];

/** Phase-one event types. Broader feeds land in a later ingestion phase. */
export const BRAIN_EVENT_TYPES = [
  "user.signed_up",
  "auth.signed_in",
  "email.queued",
  "email.skipped",
  "email.render_failed",
  "email.send_attempted",
  "email.sent",
  "email.send_failed",
  "stripe.webhook_received",
  "payment.subscription_changed",
  "payment.invoice_changed",
  "payment.one_time_purchase",
  "payment.item_quantity_changed",
  "payment.refunded",
] as const;
export type BrainEventType = typeof BRAIN_EVENT_TYPES[number];

export const BRAIN_AUTH_REASONS = [
  "password_signin",
  "otp_signin",
  "oauth_signin",
  "passkey_signin",
  "signup",
  "mfa_completion",
  "impersonation",
  "anonymous_session",
  "token_refresh",
  "other",
] as const;
export type BrainAuthReason = typeof BRAIN_AUTH_REASONS[number];
