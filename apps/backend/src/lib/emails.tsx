import { getPrismaClientForTenancy } from '@/prisma-client';
import { DEFAULT_TEMPLATE_IDS } from '@stackframe/stack-shared/dist/helpers/emails';
import { UsersCrud } from '@stackframe/stack-shared/dist/interface/crud/users';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { StackAssertionError, StatusError, captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { filterUndefined, omit, pick } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { traceSpan } from '@stackframe/stack-shared/dist/utils/telemetry';
import nodemailer from 'nodemailer';
import { getEmailThemeForTemplate, renderEmailWithTemplate } from './email-rendering';
import { Tenancy, getTenancy } from './tenancies';


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

export function isSecureEmailPort(port: number | string) {
  let parsedPort = parseInt(port.toString());
  return parsedPort === 465;
}

export type EmailConfig = {
  host: string,
  port: number,
  username: string,
  password: string,
  senderEmail: string,
  senderName: string,
  secure: boolean,
  type: 'shared' | 'standard',
}

type SendEmailOptions = {
  tenancyId: string,
  emailConfig: EmailConfig,
  to: string | string[],
  subject: string,
  html?: string,
  text?: string,
}

async function _sendEmailWithoutRetries(options: SendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  let finished = false;
  runAsynchronously(async () => {
    await wait(10000);
    if (!finished) {
      captureError("email-send-timeout", new StackAssertionError("Email send took longer than 10s; maybe the email service is too slow?", {
        config: options.emailConfig.type === 'shared' ? "shared" : pick(options.emailConfig, ['host', 'port', 'username', 'senderEmail', 'senderName']),
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }));
    }
  });
  try {
    let toArray = typeof options.to === 'string' ? [options.to] : options.to;

    // If using the shared email config, use Emailable to check if the email is valid. skip the ones that are not (it's as if they had bounced)
    const emailableApiKey = getEnvVariable('STACK_EMAILABLE_API_KEY', "");
    if (options.emailConfig.type === 'shared' && emailableApiKey) {
      await traceSpan('verifying email addresses with Emailable', async () => {
        toArray = (await Promise.all(toArray.map(async (to) => {
          const emailableResponseResult = await Result.retry(async (attempt) => {
            const res = await fetch(`https://api.emailable.com/v1/verify?email=${encodeURIComponent(options.to as string)}&api_key=${emailableApiKey}`);
            if (res.status === 249) {
              const text = await res.text();
              console.log('Emailable is taking longer than expected, retrying...', text, { to: options.to });
              return Result.error(new Error("Emailable API returned a 249 error for " + options.to + ". This means it takes some more time to verify the email address. Response body: " + text));
            }
            return Result.ok(res);
          }, 4, { exponentialDelayBase: 4000 });
          if (emailableResponseResult.status === 'error') {
            captureError("emailable-api-timeout", emailableResponseResult.error);
            return to;
          }
          const emailableResponse = emailableResponseResult.data;
          if (!emailableResponse.ok) {
            throw new StackAssertionError("Failed to verify email address with Emailable", {
              to: options.to,
              emailableResponse,
              emailableResponseText: await emailableResponse.text(),
            });
          }
          const json = await emailableResponse.json();
          console.log('emailableResponse', json);
          if (json.state === 'undeliverable' || json.disposable) {
            console.log('email not deliverable', to, json);
            return null;
          }
          return to;
        }))).filter((to): to is string => to !== null);
      });
    }

    if (toArray.length === 0) {
      // no valid emails, so we can just return ok
      // (we skip silently because this is not an error)
      return Result.ok(undefined);
    }

    return await traceSpan('sending email to ' + JSON.stringify(toArray), async () => {
      try {
        const transporter = nodemailer.createTransport({
          host: options.emailConfig.host,
          port: options.emailConfig.port,
          secure: options.emailConfig.secure,
          auth: {
            user: options.emailConfig.username,
            pass: options.emailConfig.password,
          },
        });

        await transporter.sendMail({
          from: `"${options.emailConfig.senderName}" <${options.emailConfig.senderEmail}>`,
          ...options,
          to: toArray,
        });

        return Result.ok(undefined);
      } catch (error) {
        if (error instanceof Error) {
          const code = (error as any).code as string | undefined;
          const responseCode = (error as any).responseCode as number | undefined;
          const errorNumber = (error as any).errno as number | undefined;

          const getServerResponse = (error: any) => {
            if (error?.response) {
              return `\nResponse from the email server:\n${error.response}`;
            }
            return '';
          };

          if (errorNumber === -3008 || code === 'EDNS') {
            return Result.error({
              rawError: error,
              errorType: 'HOST_NOT_FOUND',
              canRetry: false,
              message: 'Failed to connect to the email host. Please make sure the email host configuration is correct.'
            } as const);
          }

          if (responseCode === 535 || code === 'EAUTH') {
            return Result.error({
              rawError: error,
              errorType: 'AUTH_FAILED',
              canRetry: false,
              message: 'Failed to authenticate with the email server. Please check your email credentials configuration.',
            } as const);
          }

          if (responseCode === 450) {
            return Result.error({
              rawError: error,
              errorType: 'TEMPORARY',
              canRetry: true,
              message: 'The email server returned a temporary error. This could be due to a temporary network issue or a temporary block on the email server. Please try again later.\n\nError: ' + getServerResponse(error),
            } as const);
          }

          if (responseCode === 553) {
            return Result.error({
              rawError: error,
              errorType: 'INVALID_EMAIL_ADDRESS',
              canRetry: false,
              message: 'The email address provided is invalid. Please verify both the recipient and sender email addresses configuration are correct.\n\nError:' + getServerResponse(error),
            } as const);
          }

          if (responseCode === 554 || code === 'EENVELOPE') {
            return Result.error({
              rawError: error,
              errorType: 'REJECTED',
              canRetry: false,
              message: 'The email server rejected the email. Please check your email configuration and try again later.\n\nError:' + getServerResponse(error),
            } as const);
          }

          if (code === 'ETIMEDOUT') {
            return Result.error({
              rawError: error,
              errorType: 'TIMEOUT',
              canRetry: true,
              message: 'The email server timed out while sending the email. This could be due to a temporary network issue or a temporary block on the email server. Please try again later.',
            } as const);
          }

          if (error.message.includes('Unexpected socket close')) {
            return Result.error({
              rawError: error,
              errorType: 'SOCKET_CLOSED',
              canRetry: false,
              message: 'Connection to email server was lost unexpectedly. This could be due to incorrect email server port configuration or a temporary network issue. Please verify your configuration and try again.',
            } as const);
          }
        }

        // ============ temporary error ============
        const temporaryErrorIndicators = [
          "450 ",
          "Client network socket disconnected before secure TLS connection was established",
          "Too many requests",
          ...options.emailConfig.host.includes("resend") ? [
            // Resend is a bit unreliable, so we'll retry even in some cases where it may send duplicate emails
            "ECONNRESET",
          ] : [],
        ];
        if (temporaryErrorIndicators.some(indicator => error instanceof Error && error.message.includes(indicator))) {
          // this can happen occasionally (especially with certain unreliable email providers)
          // so let's retry
          return Result.error({
            rawError: error,
            errorType: 'UNKNOWN',
            canRetry: true,
            message: 'Failed to send email, but error is possibly transient due to the internet connection. Please check your email configuration and try again later.',
          } as const);
        }

        // ============ unknown error ============
        return Result.error({
          rawError: error,
          errorType: 'UNKNOWN',
          canRetry: false,
          message: 'An unknown error occurred while sending the email.',
        } as const);
      }
    });
  } finally {
    finished = true;
  }
}

export async function sendEmailWithoutRetries(options: SendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  const res = await _sendEmailWithoutRetries(options);
  const tenancy = await getTenancy(options.tenancyId);
  if (!tenancy) {
    throw new StackAssertionError("Tenancy not found");
  }

  const prisma = await getPrismaClientForTenancy(tenancy);

  await prisma.sentEmail.create({
    data: {
      tenancyId: options.tenancyId,
      to: typeof options.to === 'string' ? [options.to] : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      senderConfig: omit(options.emailConfig, ['password']),
      error: res.status === 'error' ? res.error : undefined,
    },
  });
  return res;
}

export async function sendEmail(options: SendEmailOptions) {
  if (!options.to) {
    throw new StackAssertionError("No recipient email address provided to sendEmail", omit(options, ['emailConfig']));
  }

  const errorMessage = "Failed to send email. If you are the admin of this project, please check the email configuration and try again.";

  const handleError = (error: any) => {
    console.warn("Failed to send email", error);
    if (options.emailConfig.type === 'shared') {
      captureError("failed-to-send-email-to-shared-email-config", error);
    }
    throw new StatusError(400, errorMessage);
  };

  const result = await Result.retry(async (attempt) => {
    const result = await sendEmailWithoutRetries(options);

    if (result.status === 'error') {
      const extraData = {
        host: options.emailConfig.host,
        from: options.emailConfig.senderEmail,
        to: options.to,
        subject: options.subject,
        error: result.error,
      };

      if (result.error.canRetry) {
        console.warn("Failed to send email, but error is possibly transient so retrying.", extraData, result.error.rawError);
        return Result.error(result.error);
      }

      handleError(extraData);
    }

    return result;
  }, 3, { exponentialDelayBase: 2000 });

  if (result.status === 'error') {
    handleError(result.error);
  }
}

export async function sendEmailFromTemplate(options: {
  tenancy: Tenancy,
  user: UsersCrud["Admin"]["Read"] | null,
  email: string,
  templateType: keyof typeof DEFAULT_TEMPLATE_IDS,
  extraVariables: Record<string, string | null>,
  version?: 1 | 2,
}) {
  const template = getDefaultEmailTemplate(options.tenancy, options.templateType);
  const themeSource = getEmailThemeForTemplate(options.tenancy, template.themeId);
  const variables = filterUndefined({
    projectDisplayName: options.tenancy.project.display_name,
    userDisplayName: options.user?.display_name ?? "",
    ...filterUndefined(options.extraVariables),
  });

  const result = await renderEmailWithTemplate(
    template.tsxSource,
    themeSource,
    {
      user: { displayName: options.user?.display_name ?? null },
      project: { displayName: options.tenancy.project.display_name },
      variables,
    }
  );
  if (result.status === 'error') {
    throw new StackAssertionError("Failed to render email template", {
      template: template,
      theme: themeSource,
      variables,
      result
    });
  }

  await sendEmail({
    tenancyId: options.tenancy.id,
    emailConfig: await getEmailConfig(options.tenancy),
    to: options.email,
    subject: result.data.subject ?? "",
    html: result.data.html,
    text: result.data.text,
  });
}

export async function getEmailConfig(tenancy: Tenancy): Promise<EmailConfig> {
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


export async function getSharedEmailConfig(displayName: string): Promise<EmailConfig> {
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
