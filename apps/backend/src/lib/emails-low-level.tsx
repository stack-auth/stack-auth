/**
 *
 * Low-level email sending functions that bypass the email outbox queue and send directly via SMTP or email service
 * providers. You probably shouldn't use this and should instead use the functions in emails.tsx.
 */

import { StackAssertionError, captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { omit, pick } from '@stackframe/stack-shared/dist/utils/objects';
import { runAsynchronously, wait } from '@stackframe/stack-shared/dist/utils/promises';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { traceSpan } from '@stackframe/stack-shared/dist/utils/telemetry';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { getTenancy } from './tenancies';

export function isSecureEmailPort(port: number | string) {
  // "secure" in most SMTP clients means implicit TLS from byte 1 (SMTPS)
  // STARTTLS ports (25/587/2587) should return false.
  let parsedPort = parseInt(port.toString());
  return parsedPort === 465 || parsedPort === 2465;
}

export type LowLevelEmailConfig = {
  host: string,
  port: number,
  username: string,
  password: string,
  senderEmail: string,
  senderName: string,
  secure: boolean,
  type: 'shared' | 'standard',
}

export type LowLevelSendEmailOptions = {
  tenancyId: string,
  emailConfig: LowLevelEmailConfig,
  to: string | string[],
  subject: string,
  html?: string,
  text?: string,
}

async function _lowLevelSendEmailWithoutRetries(options: LowLevelSendEmailOptions): Promise<Result<undefined, {
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
    const toArray = typeof options.to === 'string' ? [options.to] : options.to;

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
          connectionTimeout: 15000,
          greetingTimeout: 10000,
          socketTimeout: 20000,
          dnsTimeout: 7000,
          auth: {
            user: options.emailConfig.username,
            pass: options.emailConfig.password,
          },
        });

        try {
          await transporter.sendMail({
            from: `"${options.emailConfig.senderName}" <${options.emailConfig.senderEmail}>`,
            ...options,
            to: toArray,
          });
        } finally {
          transporter.close();
        }

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
        captureError("unknown-email-send-error", new StackAssertionError("Unknown error while sending email. We should add a better error description for the user.", { cause: error }));
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

export async function lowLevelSendEmailDirectWithoutRetries(options: LowLevelSendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  return await _lowLevelSendEmailWithoutRetries(options);
}

// currently unused, although in the future we may want to use this to minimize the number of requests to Resend
export async function lowLevelSendEmailResendBatchedDirect(resendApiKey: string, emailOptions: LowLevelSendEmailOptions[]) {
  if (emailOptions.length === 0) {
    return Result.ok([]);
  }
  if (emailOptions.length > 100) {
    throw new StackAssertionError("sendEmailResendBatchedDirect expects at most 100 emails to be sent at once", { emailOptions });
  }
  if (emailOptions.some(option => option.tenancyId !== emailOptions[0].tenancyId)) {
    throw new StackAssertionError("sendEmailResendBatchedDirect expects all emails to be sent from the same tenancy", { emailOptions });
  }
  const tenancy = await getTenancy(emailOptions[0].tenancyId);
  if (!tenancy) {
    throw new StackAssertionError("Tenancy not found");
  }
  const resend = new Resend(resendApiKey);
  const result = await Result.retry(async (_) => {
    const { data, error } = await resend.batch.send(emailOptions.map((option) => ({
      from: option.emailConfig.senderEmail,
      to: option.to,
      subject: option.subject,
      html: option.html ?? "",
      text: option.text,
    })));

    if (data) {
      return Result.ok(data.data);
    }
    if (error.name === "rate_limit_exceeded" || error.name === "internal_server_error") {
      // these are the errors we want to retry
      return Result.error(error);
    }
    throw new StackAssertionError("Failed to send email with Resend", { error });
  }, 3, { exponentialDelayBase: 2000 });

  return result;
}

export async function lowLevelSendEmailDirectViaProvider(options: LowLevelSendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  if (!options.to) {
    throw new StackAssertionError("No recipient email address provided to sendEmail", omit(options, ['emailConfig']));
  }

  class DoNotRetryError extends Error {
    constructor(public readonly errorObj: {
      rawError: any,
      errorType: string,
      canRetry: boolean,
      message?: string,
    }) {
      super("This error should never be caught anywhere else but inside the lowLevelSendEmailDirectViaProvider function, something went wrong if you see this!");
    }
  }

  let result;
  try {
    result = await Result.retry(async (attempt) => {
      const result = await lowLevelSendEmailDirectWithoutRetries(options);

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

        console.warn("Failed to send email, and error is not transient, so not retrying.", extraData, result.error.rawError);
        throw new DoNotRetryError(result.error);
      }

      return result;
    }, 3, { exponentialDelayBase: 2000 });
  } catch (error) {
    if (error instanceof DoNotRetryError) {
      return Result.error(error.errorObj);
    }
    throw error;
  }

  if (result.status === 'error') {
    console.warn("Failed to send email after all retries!", result.error);
    return Result.error(result.error.errors[0]);
  }
  return Result.ok(undefined);
}
