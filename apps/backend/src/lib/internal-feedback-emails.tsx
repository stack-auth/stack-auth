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
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="margin: 0 0 20px;">Support feedback submission</h2>
      <p><strong>Sender name:</strong> ${formatTextForHtml(displayName)}</p>
      <p><strong>Sender email:</strong> ${formatTextForHtml(options.email)}</p>
      <p><strong>Stack Auth user ID:</strong> ${formatTextForHtml(options.user.id)}</p>
      <p><strong>Stack Auth display name:</strong> ${formatTextForHtml(options.user.display_name ?? "Not provided")}</p>
      <div style="margin-top: 24px;">
        <p style="margin-bottom: 8px;"><strong>Message</strong></p>
        <div style="padding: 16px; border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb; white-space: normal;">
          ${formatTextForHtml(options.message)}
        </div>
      </div>
    </div>
  `;

  await sendInternalOperationsEmail({
    tenancy: options.tenancy,
    subject: `[Support] ${options.email}`,
    htmlContent,
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
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="margin: 0 0 20px;">New feature request submitted</h2>
      <p><strong>Title:</strong> ${formatTextForHtml(options.title)}</p>
      <p><strong>Featurebase post ID:</strong> ${formatTextForHtml(options.featureRequestId)}</p>
      <p><strong>Featurebase URL:</strong> <a href="${escapeHtml(featureRequestUrl)}">${escapeHtml(featureRequestUrl)}</a></p>
      <p><strong>Submitted by:</strong> ${formatTextForHtml(options.user.display_name ?? "Not provided")}</p>
      <p><strong>Submitted email:</strong> ${formatTextForHtml(options.user.primary_email ?? "Not provided")}</p>
      <p><strong>Stack Auth user ID:</strong> ${formatTextForHtml(options.user.id)}</p>
      <div style="margin-top: 24px;">
        <p style="margin-bottom: 8px;"><strong>Details</strong></p>
        <div style="padding: 16px; border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb; white-space: normal;">
          ${formatTextForHtml(options.content ?? "Not provided")}
        </div>
      </div>
    </div>
  `;

  await sendInternalOperationsEmail({
    tenancy: options.tenancy,
    subject: `[Feature Request] ${options.title}`,
    htmlContent,
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
