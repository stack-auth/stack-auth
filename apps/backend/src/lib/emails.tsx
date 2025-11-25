import { globalPrismaClient } from '@/prisma-client';
import { runAsynchronouslyAndWaitUntil } from '@/utils/vercel';
import { EmailOutboxCreatedWith } from '@prisma/client';
import { DEFAULT_TEMPLATE_IDS } from '@stackframe/stack-shared/dist/helpers/emails';
import { UsersCrud } from '@stackframe/stack-shared/dist/interface/crud/users';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { runEmailQueueStep, serializeRecipient } from './email-queue-step';
import { LowLevelEmailConfig, isSecureEmailPort } from './emails-low-level';
import { Tenancy } from './tenancies';


/**
 * Describes where an email should be delivered. Each outbox entry targets exactly one recipient entity.
 *
 * user-primary-email: the email is being sent to the primary email address of a user (determined at the time of sending, NOT the time of creation/rendering). if the user unsubscribes, they will not receive the email.
 * user-custom-emails: the email is being sent to a list of custom emails, but if the user unsubscribes, they will no longer receive the email.
 * custom-emails: the email is being sent to a list of custom emails. there is no associated user object and the recipient cannot unsubscribe. cannot be used to send non-transactional emails.
 */
export type EmailOutboxRecipient =
  | { type: "user-primary-email", userId: string }
  | { type: "user-custom-emails", userId: string, emails: string[] }
  | { type: "custom-emails", emails: string[] };

function getDefaultEmailTemplate(tenancy: Tenancy, type: keyof typeof DEFAULT_TEMPLATE_IDS) {
  const templateList = new Map(Object.entries(tenancy.config.emails.templates));
  const defaultTemplateIdsMap = new Map(Object.entries(DEFAULT_TEMPLATE_IDS));
  const defaultTemplateId = defaultTemplateIdsMap.get(type);
  if (defaultTemplateId) {
    const template = templateList.get(defaultTemplateId);
    if (!template) {
      throw new StackAssertionError(`Default email template not found: ${type}`);
    }
    return template;
  }
  throw new StackAssertionError(`Unknown email template type: ${type}`);
}

export async function sendEmailToMany(options: {
  tenancy: Tenancy,
  recipients: EmailOutboxRecipient[],
  tsxSource: string,
  extraVariables: Record<string, string | null>,
  themeId: string | null,
  isHighPriority: boolean,
  shouldSkipDeliverabilityCheck: boolean,
  scheduledAt: Date,
  createdWith: { type: "draft", draftId: string } | { type: "programmatic-call", templateId: string | null },
  overrideSubject?: string,
  overrideNotificationCategoryId?: string,
}) {
  await globalPrismaClient.emailOutbox.createMany({
    data: options.recipients.map(recipient => ({
      tenancyId: options.tenancy.id,
      tsxSource: options.tsxSource,
      themeId: options.themeId,
      isHighPriority: options.isHighPriority,
      createdWith: options.createdWith.type === "draft" ? EmailOutboxCreatedWith.DRAFT : EmailOutboxCreatedWith.PROGRAMMATIC_CALL,
      emailDraftId: options.createdWith.type === "draft" ? options.createdWith.draftId : undefined,
      emailProgrammaticCallTemplateId: options.createdWith.type === "programmatic-call" ? options.createdWith.templateId : undefined,
      to: serializeRecipient(recipient)!,
      extraRenderVariables: options.extraVariables,
      scheduledAt: options.scheduledAt,
      shouldSkipDeliverabilityCheck: options.shouldSkipDeliverabilityCheck,
      overrideSubject: options.overrideSubject,
      overrideNotificationCategoryId: options.overrideNotificationCategoryId,
    })),
  });
  // The cron job should run runEmailQueueStep() to process the emails, but we call it here again for those self-hosters
  // who didn't set up the cron job correctly, and also just in case something happens to the cron job.
  runAsynchronouslyAndWaitUntil(runEmailQueueStep());
}

export async function sendEmailFromDefaultTemplate(options: {
  tenancy: Tenancy,
  user: UsersCrud["Admin"]["Read"] | null,
  email: string,
  templateType: keyof typeof DEFAULT_TEMPLATE_IDS,
  extraVariables: Record<string, string | null>,
  shouldSkipDeliverabilityCheck: boolean,
  version?: 1 | 2,
}) {
  const template = getDefaultEmailTemplate(options.tenancy, options.templateType);

  await sendEmailToMany({
    tenancy: options.tenancy,
    recipients: [options.user ? { type: "user-custom-emails", userId: options.user.id, emails: [options.email] } : { type: "custom-emails", emails: [options.email] }],
    tsxSource: template.tsxSource,
    extraVariables: options.extraVariables,
    themeId: template.themeId === false ? null : (template.themeId ?? options.tenancy.config.emails.selectedThemeId),
    createdWith: { type: "programmatic-call", templateId: DEFAULT_TEMPLATE_IDS[options.templateType] },
    isHighPriority: options.shouldSkipDeliverabilityCheck,  // always make emails sent via default template high priority
    shouldSkipDeliverabilityCheck: options.shouldSkipDeliverabilityCheck,
    scheduledAt: new Date(),
  });
}

export async function getEmailConfig(tenancy: Tenancy): Promise<LowLevelEmailConfig> {
  const projectEmailConfig = tenancy.config.emails.server;

  if (projectEmailConfig.isShared) {
    return await getSharedEmailConfig(tenancy.project.display_name);
  } else {
    if (!projectEmailConfig.host || !projectEmailConfig.port || !projectEmailConfig.username || !projectEmailConfig.password || !projectEmailConfig.senderEmail || !projectEmailConfig.senderName) {
      throw new StackAssertionError("Email config is not complete despite not being shared. This should never happen?", { projectId: tenancy.id, emailConfig: projectEmailConfig });
    }
    return {
      host: projectEmailConfig.host,
      port: projectEmailConfig.port,
      username: projectEmailConfig.username,
      password: projectEmailConfig.password,
      senderEmail: projectEmailConfig.senderEmail,
      senderName: projectEmailConfig.senderName,
      secure: isSecureEmailPort(projectEmailConfig.port),
      type: 'standard',
    };
  }
}


export async function getSharedEmailConfig(displayName: string): Promise<LowLevelEmailConfig> {
  return {
    host: getEnvVariable('STACK_EMAIL_HOST'),
    port: parseInt(getEnvVariable('STACK_EMAIL_PORT')),
    username: getEnvVariable('STACK_EMAIL_USERNAME'),
    password: getEnvVariable('STACK_EMAIL_PASSWORD'),
    senderEmail: getEnvVariable('STACK_EMAIL_SENDER'),
    senderName: displayName,
    secure: isSecureEmailPort(getEnvVariable('STACK_EMAIL_PORT')),
    type: 'shared',
  };
}

export function normalizeEmail(email: string): string {
  if (typeof email !== 'string') {
    throw new TypeError('normalize-email expects a string');
  }


  const emailLower = email.trim().toLowerCase();
  const emailParts = emailLower.split(/@/);

  if (emailParts.length !== 2) {
    throw new StackAssertionError('Invalid email address', { email });
  }

  let [username, domain] = emailParts;

  return `${username}@${domain}`;
}

import.meta.vitest?.test('normalizeEmail(...)', async ({ expect }) => {
  expect(normalizeEmail('Example.Test@gmail.com')).toBe('example.test@gmail.com');
  expect(normalizeEmail('Example.Test+123@gmail.com')).toBe('example.test+123@gmail.com');
  expect(normalizeEmail('exampletest@gmail.com')).toBe('exampletest@gmail.com');
  expect(normalizeEmail('EXAMPLETEST@gmail.com')).toBe('exampletest@gmail.com');

  expect(normalizeEmail('user@example.com')).toBe('user@example.com');
  expect(normalizeEmail('user.name+tag@example.com')).toBe('user.name+tag@example.com');

  expect(() => normalizeEmail('test@multiple@domains.com')).toThrow();
  expect(() => normalizeEmail('invalid.email')).toThrow();
});
