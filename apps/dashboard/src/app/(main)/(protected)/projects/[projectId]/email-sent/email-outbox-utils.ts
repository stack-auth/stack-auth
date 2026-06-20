import type { AdminEmailOutbox } from "@hexclave/next";

export type EmailWithDeliveredAt = AdminEmailOutbox & {
  deliveredAt?: Date | string | null,
};

export function hasDeliveredAt(email: AdminEmailOutbox): email is EmailWithDeliveredAt {
  return "deliveredAt" in email;
}

export function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  }
  if (to.type === "user-custom-emails") {
    return to.emails[0] ?? `User: ${to.userId.slice(0, 8)}...`;
  }
  return to.emails[0] ?? "No recipients";
}

export function getEmailTimestamp(email: AdminEmailOutbox): Date {
  const deliveredAt = hasDeliveredAt(email) ? email.deliveredAt : undefined;
  return deliveredAt != null ? new Date(deliveredAt) : email.scheduledAt;
}
