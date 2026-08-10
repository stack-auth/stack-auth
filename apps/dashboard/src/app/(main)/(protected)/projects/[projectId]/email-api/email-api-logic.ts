import type { AdminEmailOutbox, AdminEmailOutboxStatus } from "@hexclave/next";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";

export type EmailApiSource = {
  id: string,
  displayName: string,
  count: number,
  lastSentAt: Date | null,
  statuses: Partial<Record<AdminEmailOutboxStatus, number>>,
};

export function isEmailApiEmail(email: Pick<AdminEmailOutbox, "createdWith">): boolean {
  return email.createdWith === "programmatic-call";
}

export function countEmailsSince(
  emails: Pick<AdminEmailOutbox, "createdAt">[],
  now: Date,
  durationMillis: number,
): number {
  const start = now.getTime() - durationMillis;
  return emails.filter((email) => {
    const createdAt = email.createdAt.getTime();
    return createdAt >= start && createdAt <= now.getTime();
  }).length;
}

export function groupEmailsBySource(
  emails: Pick<AdminEmailOutbox, "createdAt" | "status" | "emailProgrammaticCallTemplateId">[],
  templateNames: ReadonlyMap<string, string>,
): EmailApiSource[] {
  const groups = new Map<string, EmailApiSource>();
  for (const email of emails) {
    const id = email.emailProgrammaticCallTemplateId ?? "html";
    const existing = groups.get(id);
    const source = existing ?? {
      id,
      displayName: id === "html"
        ? "Raw HTML"
        : templateNames.get(id) ?? `Template (${id.slice(0, 8)}...)`,
      count: 0,
      lastSentAt: null,
      statuses: {},
    };
    source.count++;
    source.lastSentAt = source.lastSentAt == null || email.createdAt > source.lastSentAt
      ? email.createdAt
      : source.lastSentAt;
    source.statuses[email.status] = (source.statuses[email.status] ?? 0) + 1;
    groups.set(id, source);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || stringCompare(a.displayName, b.displayName));
}

export function getDeliverySuccessRate(emails: Pick<AdminEmailOutbox, "status">[]): number {
  if (emails.length === 0) return 0;
  return emails.filter((email) => (
    email.status === "sent" ||
    email.status === "opened" ||
    email.status === "clicked" ||
    email.status === "delivery-delayed"
  )).length / emails.length;
}
