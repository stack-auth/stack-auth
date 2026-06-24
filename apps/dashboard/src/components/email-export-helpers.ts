import type { AdminEmailOutbox, AdminEmailOutboxSimpleStatus, AdminEmailOutboxStatus } from "@hexclave/next";

export const EMAIL_STATUS_LABELS: Record<AdminEmailOutboxStatus, string> = {
  "paused": "Paused",
  "preparing": "Preparing",
  "rendering": "Rendering",
  "render-error": "Render Error",
  "scheduled": "Scheduled",
  "queued": "Queued",
  "sending": "Sending",
  "server-error": "Server Error",
  "skipped": "Skipped",
  "bounced": "Bounced",
  "delivery-delayed": "Delivery Delayed",
  "sent": "Sent",
  "opened": "Opened",
  "clicked": "Clicked",
  "marked-as-spam": "Marked as Spam",
};

export const EMAIL_SIMPLE_STATUS_LABELS: Record<AdminEmailOutboxSimpleStatus, string> = {
  "in-progress": "In Progress",
  "ok": "Completed",
  "error": "Error",
};

export function getEmailRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  }
  if (to.type === "user-custom-emails") {
    return to.emails.join(", ") || `User: ${to.userId.slice(0, 8)}...`;
  }
  return to.emails.join(", ") || "No recipients";
}

export function getEmailSubjectDisplay(email: AdminEmailOutbox): string {
  if ("subject" in email && typeof email.subject === "string" && email.subject !== "") {
    return email.subject;
  }
  return "(Not yet rendered)";
}
