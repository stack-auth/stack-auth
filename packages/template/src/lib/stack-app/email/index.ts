import { XOR } from "@stackframe/stack-shared/dist/utils/types";

export type AdminSentEmail = {
  id: string,
  to: string[],
  subject: string,
  recipient: string, // We'll derive this from to[0] for display
  sentAt: Date, // We'll derive this from sent_at_millis for display
  error?: unknown,
}

export type AdminEmailOutboxRecipient =
  | { type: "user-primary-email", userId: string }
  | { type: "user-custom-emails", userId: string, emails: string[] }
  | { type: "custom-emails", emails: string[] };

export type AdminEmailOutboxStatus =
  | "paused"
  | "preparing"
  | "rendering"
  | "render-error"
  | "scheduled"
  | "queued"
  | "sending"
  | "server-error"
  | "skipped"
  | "bounced"
  | "delivery-delayed"
  | "sent"
  | "opened"
  | "clicked"
  | "marked-as-spam";

export type AdminEmailOutboxSimpleStatus =
  | "in-progress"
  | "ok"
  | "error";

// =============================== BASE TYPES ===============================

// Base fields present on all emails
type AdminEmailOutboxBase = {
  id: string,
  createdAt: Date,
  updatedAt: Date,
  to: AdminEmailOutboxRecipient,
  scheduledAt: Date,
  isPaused: false,
  hasRendered: false,
  hasDelivered: false,
};

// Fields available after rendering completes successfully
type AdminEmailOutboxRenderedFields = AdminEmailOutboxBase & {
  startedRenderingAt: Date,
  renderedAt: Date,
  subject: string,
  html: string | null,
  text: string | null,
  isTransactional: boolean,
  isHighPriority: boolean,
  notificationCategoryId: string | null,
  hasRendered: true,
};

// Fields available after sending starts
type AdminEmailOutboxStartedSendingFields = AdminEmailOutboxRenderedFields & {
  startedSendingAt: Date,
};

// Fields available after delivery completes
type AdminEmailOutboxFinishedDeliveringFields = AdminEmailOutboxStartedSendingFields & {
  deliveredAt: Date,
  hasDelivered: true,
};

// =============================== STATUS-SPECIFIC TYPES ===============================

export type AdminEmailOutboxPaused = AdminEmailOutboxBase & {
  status: "paused",
  simpleStatus: "in-progress",
  isPaused: true,
};

export type AdminEmailOutboxPreparing = AdminEmailOutboxBase & {
  status: "preparing",
  simpleStatus: "in-progress",
};

export type AdminEmailOutboxRendering = AdminEmailOutboxBase & {
  status: "rendering",
  simpleStatus: "in-progress",
  startedRenderingAt: Date,
};

export type AdminEmailOutboxRenderError = AdminEmailOutboxBase & {
  status: "render-error",
  simpleStatus: "error",
  startedRenderingAt: Date,
  renderedAt: Date,
  renderError: string,
};

export type AdminEmailOutboxScheduled = AdminEmailOutboxRenderedFields & {
  status: "scheduled",
  simpleStatus: "in-progress",
};

export type AdminEmailOutboxQueued = AdminEmailOutboxRenderedFields & {
  status: "queued",
  simpleStatus: "in-progress",
};

export type AdminEmailOutboxSending = AdminEmailOutboxStartedSendingFields & {
  status: "sending",
  simpleStatus: "in-progress",
};

export type AdminEmailOutboxServerError = AdminEmailOutboxStartedSendingFields & {
  status: "server-error",
  simpleStatus: "error",
  errorAt: Date,
  serverError: string,
};

// SKIPPED can happen at any time, so rendering/sending fields are optional
export type AdminEmailOutboxSkipped = AdminEmailOutboxBase & {
  status: "skipped",
  simpleStatus: "ok",
  skippedAt: Date,
  skippedReason: string,
  skippedDetails: Record<string, unknown>,
  hasRendered: boolean,
  // Optional fields depending on when skipped
  startedRenderingAt?: Date,
  renderedAt?: Date,
  subject?: string,
  html?: string | null,
  text?: string | null,
  isTransactional?: boolean,
  isHighPriority?: boolean,
  notificationCategoryId?: string | null,
  startedSendingAt?: Date,
};

export type AdminEmailOutboxBounced = AdminEmailOutboxStartedSendingFields & {
  status: "bounced",
  simpleStatus: "error",
  bouncedAt: Date,
};

export type AdminEmailOutboxDeliveryDelayed = AdminEmailOutboxStartedSendingFields & {
  status: "delivery-delayed",
  simpleStatus: "ok",
  deliveryDelayedAt: Date,
};

export type AdminEmailOutboxSent = AdminEmailOutboxFinishedDeliveringFields & {
  status: "sent",
  simpleStatus: "ok",
  canHaveDeliveryInfo: boolean,
};

export type AdminEmailOutboxOpened = AdminEmailOutboxFinishedDeliveringFields & {
  status: "opened",
  simpleStatus: "ok",
  openedAt: Date,
  canHaveDeliveryInfo: true,
};

export type AdminEmailOutboxClicked = AdminEmailOutboxFinishedDeliveringFields & {
  status: "clicked",
  simpleStatus: "ok",
  clickedAt: Date,
  canHaveDeliveryInfo: true,
};

export type AdminEmailOutboxMarkedAsSpam = AdminEmailOutboxFinishedDeliveringFields & {
  status: "marked-as-spam",
  simpleStatus: "ok",
  markedAsSpamAt: Date,
  canHaveDeliveryInfo: true,
};

// =============================== DISCRIMINATED UNION ===============================

export type AdminEmailOutbox =
  | AdminEmailOutboxPaused
  | AdminEmailOutboxPreparing
  | AdminEmailOutboxRendering
  | AdminEmailOutboxRenderError
  | AdminEmailOutboxScheduled
  | AdminEmailOutboxQueued
  | AdminEmailOutboxSending
  | AdminEmailOutboxServerError
  | AdminEmailOutboxSkipped
  | AdminEmailOutboxBounced
  | AdminEmailOutboxDeliveryDelayed
  | AdminEmailOutboxSent
  | AdminEmailOutboxOpened
  | AdminEmailOutboxClicked
  | AdminEmailOutboxMarkedAsSpam;

type SendEmailOptionsBase = {
  themeId?: string | null | false,
  subject?: string,
  notificationCategoryName?: string,
}


export type SendEmailOptions = SendEmailOptionsBase
  & XOR<[
    { userIds: string[] },
    { allUsers: true }
  ]>
  & XOR<[
    { html: string },
    {
      templateId: string,
      variables?: Record<string, any>,
    },
    { draftId: string }
  ]>

export type EmailDeliveryWindowStats = {
  sent: number,
  bounced: number,
  marked_as_spam: number,
};

export type EmailDeliveryStats = {
  hour: EmailDeliveryWindowStats,
  day: EmailDeliveryWindowStats,
  week: EmailDeliveryWindowStats,
  month: EmailDeliveryWindowStats,
};

export type EmailDeliveryCapacity = {
  rate_per_second: number,
  penalty_factor: number,
};

export type EmailDeliveryInfo = {
  stats: EmailDeliveryStats,
  capacity: EmailDeliveryCapacity,
};
