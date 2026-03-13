import { createTemplateComponentFromHtml } from "@/lib/email-rendering";
import { getEmailConfig, normalizeEmail, sendEmailToMany } from "@/lib/emails";
import { getNotificationCategoryByName } from "@/lib/notification-categories";
import { Tenancy } from "@/lib/tenancies";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { throwErr, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { escapeHtml } from "@stackframe/stack-shared/dist/utils/html";
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";

const defaultRecipient = "team@stack-auth.com";
const transactionalCategoryId = getNotificationCategoryByName("Transactional")?.id ?? throwErr("Transactional notification category not found");

function formatTextForHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function sanitizeSubject(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildInternalEmailHtml(options: {
  heading: string,
  fields: Array<{ label: string, value: string } | { label: string, href: string, linkText: string }>,
  contentLabel: string,
  contentBody: string,
}): string {
  const fieldRows = options.fields.map((field) => {
    if ("href" in field) {
      return `<p><strong>${escapeHtml(field.label)}:</strong> <a href="${escapeHtml(field.href)}">${escapeHtml(field.linkText)}</a></p>`;
    }
    return `<p><strong>${escapeHtml(field.label)}:</strong> ${formatTextForHtml(field.value)}</p>`;
  }).join("\n      ");

  return `
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="margin: 0 0 20px;">${escapeHtml(options.heading)}</h2>
      ${fieldRows}
      <div style="margin-top: 24px;">
        <p style="margin-bottom: 8px;"><strong>${escapeHtml(options.contentLabel)}</strong></p>
        <div style="padding: 16px; border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb; white-space: normal;">
          ${formatTextForHtml(options.contentBody)}
        </div>
      </div>
    </div>
  `;
}

export function getInternalFeedbackRecipients(): string[] {
  const rawRecipients = getEnvVariable("STACK_INTERNAL_FEEDBACK_RECIPIENTS", defaultRecipient);
  const recipients = rawRecipients.split(",").map((recipient) => recipient.trim());

  if (recipients.some((recipient) => recipient.length === 0)) {
    throw new StackAssertionError("STACK_INTERNAL_FEEDBACK_RECIPIENTS contains an empty recipient", {
      rawRecipients,
    });
  }

  return [...new Set(recipients.map((recipient) => normalizeEmail(recipient)))];
}

async function sendInternalOperationsEmail(options: {
  tenancy: Tenancy,
  subject: string,
  htmlContent: string,
}) {
  await getEmailConfig(options.tenancy);

  const recipients = getInternalFeedbackRecipients();
  const tsxSource = createTemplateComponentFromHtml(options.htmlContent);

  await sendEmailToMany({
    tenancy: options.tenancy,
    recipients: recipients.map((recipient) => ({ type: "custom-emails" as const, emails: [recipient] })),
    tsxSource,
    extraVariables: {},
    themeId: null,
    isHighPriority: true,
    shouldSkipDeliverabilityCheck: true,
    scheduledAt: new Date(),
    createdWith: { type: "programmatic-call", templateId: null },
    overrideSubject: sanitizeSubject(options.subject),
    overrideNotificationCategoryId: transactionalCategoryId,
  });
}

export async function sendSupportFeedbackEmail(options: {
  tenancy: Tenancy,
  user: UsersCrud["Admin"]["Read"],
  name: string | null,
  email: string,
  message: string,
}) {
  const displayName = options.name ?? options.user.display_name ?? "Not provided";

  await sendInternalOperationsEmail({
    tenancy: options.tenancy,
    subject: `[Support] ${options.email}`,
    htmlContent: buildInternalEmailHtml({
      heading: "Support feedback submission",
      fields: [
        { label: "Sender name", value: displayName },
        { label: "Sender email", value: options.email },
        { label: "Stack Auth user ID", value: options.user.id },
        { label: "Stack Auth display name", value: options.user.display_name ?? "Not provided" },
      ],
      contentLabel: "Message",
      contentBody: options.message,
    }),
  });
}

export async function sendFeatureRequestNotificationEmail(options: {
  tenancy: Tenancy,
  user: UsersCrud["Admin"]["Read"],
  title: string,
  content: string | null,
  featureRequestId: string,
}) {
  const featureRequestUrl = new URL(urlString`/p/${options.featureRequestId}`, "https://feedback.stack-auth.com").toString();

  await sendInternalOperationsEmail({
    tenancy: options.tenancy,
    subject: `[Feature Request] ${options.title}`,
    htmlContent: buildInternalEmailHtml({
      heading: "New feature request submitted",
      fields: [
        { label: "Title", value: options.title },
        { label: "Featurebase post ID", value: options.featureRequestId },
        { label: "Featurebase URL", href: featureRequestUrl, linkText: featureRequestUrl },
        { label: "Submitted by", value: options.user.display_name ?? "Not provided" },
        { label: "Submitted email", value: options.user.primary_email ?? "Not provided" },
        { label: "Stack Auth user ID", value: options.user.id },
      ],
      contentLabel: "Details",
      contentBody: options.content ?? "Not provided",
    }),
  });
}

import.meta.vitest?.test("getInternalFeedbackRecipients()", ({ expect }) => {
  // eslint-disable-next-line no-restricted-syntax
  const previousValue = process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS;

  // eslint-disable-next-line no-restricted-syntax
  process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS = "TEAM@stack-auth.com, team@stack-auth.com , another@example.com";
  expect(getInternalFeedbackRecipients()).toEqual([
    "team@stack-auth.com",
    "another@example.com",
  ]);

  // eslint-disable-next-line no-restricted-syntax
  process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS = "valid@example.com, ";
  expect(() => getInternalFeedbackRecipients()).toThrow("empty recipient");

  // eslint-disable-next-line no-restricted-syntax
  process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS = ", ";
  expect(() => getInternalFeedbackRecipients()).toThrow("empty recipient");

  if (previousValue === undefined) {
    // eslint-disable-next-line no-restricted-syntax
    delete process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS;
  } else {
    // eslint-disable-next-line no-restricted-syntax
    process.env.STACK_INTERNAL_FEEDBACK_RECIPIENTS = previousValue;
  }
});
