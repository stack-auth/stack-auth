/**
 *
 * Low-level email sending functions that bypass the email outbox queue and send directly via SMTP or email service
 * providers. You probably shouldn't use this and should instead use the functions in emails.tsx.
 */

import { HexclaveAssertionError, captureError, throwErr } from '@hexclave/shared/dist/utils/errors';
import { omit, pick } from '@hexclave/shared/dist/utils/objects';
import { runAsynchronously, wait } from '@hexclave/shared/dist/utils/promises';
import { Result } from '@hexclave/shared/dist/utils/results';
import { traceSpan } from '@hexclave/shared/dist/utils/telemetry';
import nodemailer from 'nodemailer';
import { checkHttpEmailEgressPolicy, shouldEnforceHttpEmailEgressPolicy } from '@/lib/ssrf-protection/email-http';
import { checkSmtpEgressPolicy, shouldEnforceSmtpEgressPolicy } from '@/lib/ssrf-protection/smtp';

export function isSecureEmailPort(port: number | string) {
  // "secure" in most SMTP clients means implicit TLS from byte 1 (SMTPS)
  // STARTTLS ports (25/587/2587) should return false.
  let parsedPort = parseInt(port.toString());
  return parsedPort === 465 || parsedPort === 2465;
}

function is4yzSMTPResponseCode(code: number | undefined) {
  if (typeof code !== 'number') {
    return false;
  }
  return code >= 400 && code < 500;
}

/** Providers reached over their HTTP API rather than SMTP. */
export type HttpEmailProvider = 'resend' | 'usesend';

/**
 * Where each provider accepts a send. The request body is identical for the fields we send
 * (from/to/subject/html/text) — useSend is Resend-compatible there — so the path is the only
 * difference that matters to us. Their success responses name the id differently ('id' vs
 * 'emailId'), which is irrelevant here because we discard it.
 */
const HTTP_PROVIDER_SEND_PATHS = new Map<HttpEmailProvider, string>([
  ['resend', '/emails'],
  ['usesend', '/api/v1/emails'],
]);

/** useSend is absent on purpose: it is self-hosted, so there is no default origin to fall back to. */
const HTTP_PROVIDER_DEFAULT_BASE_URLS = new Map<HttpEmailProvider, string>([
  ['resend', 'https://api.resend.com'],
]);

const HTTP_SEND_TIMEOUT_MS = 15_000;

type CommonEmailConfig = {
  senderEmail: string,
  senderName: string,
  // 'shared': Hexclave's shared email server. 'managed': a custom domain we provision & send through on the user's
  // behalf (Resend under our account). 'standard': the user's own email server or provider account. We run the
  // Emailable deliverability check for 'shared' and 'managed' (where bad recipients hurt our own sending
  // reputation), but not for 'standard' (the user owns their own deliverability there).
  type: 'shared' | 'managed' | 'standard',
}

export type SmtpEmailConfig = CommonEmailConfig & {
  transport: 'smtp',
  host: string,
  port: number,
  username: string,
  password: string,
  secure: boolean,
}

export type HttpEmailConfig = CommonEmailConfig & {
  transport: 'http',
  provider: HttpEmailProvider,
  apiKey: string,
  /** Already resolved against HTTP_PROVIDER_DEFAULT_BASE_URLS by the time it reaches this module. */
  baseUrl: string,
}

export type LowLevelEmailConfig = SmtpEmailConfig | HttpEmailConfig;

/** Resolves a provider's origin, falling back to its public API where one exists. */
export function resolveHttpProviderBaseUrl(provider: HttpEmailProvider, configuredBaseUrl: string | undefined): string | undefined {
  return configuredBaseUrl || HTTP_PROVIDER_DEFAULT_BASE_URLS.get(provider);
}

/** Builds the send endpoint, tolerating a base URL with a trailing slash or its own path prefix. */
export function httpProviderSendUrl(config: Pick<HttpEmailConfig, 'provider' | 'baseUrl'>): string {
  const path = HTTP_PROVIDER_SEND_PATHS.get(config.provider) ?? throwErr(`Unknown HTTP email provider: ${config.provider}`);
  return `${config.baseUrl.replace(/\/+$/, '')}${path}`;
}

export type LowLevelSendEmailOptions = {
  tenancyId: string,
  emailConfig: LowLevelEmailConfig,
  to: string | string[],
  subject: string,
  html?: string,
  text?: string,
  /**
   * Sent as Idempotency-Key to HTTP providers, which both honour it. Retrying an HTTP send is
   * otherwise ambiguous — a 5xx may still have queued the message — so callers that retry the same
   * logical email (the outbox passes its row id) must set this or risk duplicate delivery.
   */
  idempotencyKey?: string,
}

async function _lowLevelSendEmailWithoutRetries(options: LowLevelSendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  let finished = false;
  // Never let credentials into an error report: SMTP configs drop `password`, and HTTP configs keep
  // only the provider and origin — never `apiKey`.
  const strippedEmailConfig = options.emailConfig.type === 'shared'
    ? "shared"
    : options.emailConfig.transport === 'smtp'
      ? pick(options.emailConfig, ['host', 'port', 'username', 'senderEmail', 'senderName'])
      : pick(options.emailConfig, ['transport', 'provider', 'baseUrl', 'senderEmail', 'senderName']);
  runAsynchronously(async () => {
    await wait(15_000);
    if (!finished) {
      captureError("email-send-timeout", new HexclaveAssertionError("Email send took longer than 15s; maybe the email service is too slow?", {
        config: strippedEmailConfig,
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
      if (options.emailConfig.transport === 'http') {
        return await sendEmailOverHttp(options, options.emailConfig, toArray, strippedEmailConfig);
      }
      const smtpConfig = options.emailConfig;
      try {
        // Only tenant-provided ("standard") SMTP configs are attacker-controlled, so the egress policy
        // only applies to those. "shared" (operator/Hexclave server) and "managed" (Resend) are trusted
        // — enforcing the policy on them would needlessly break e.g. local dev (Inbucket on 127.0.0.1).
        let connectHost = smtpConfig.host;
        let connectServername: string | undefined = undefined;
        if (smtpConfig.type === 'standard' && shouldEnforceSmtpEgressPolicy()) {
          const smtpEgressPolicyResult = await checkSmtpEgressPolicy({
            host: smtpConfig.host,
            port: smtpConfig.port,
          });
          if (smtpEgressPolicyResult.status === "error") {
            captureError("smtp-egress-policy-rejected", new HexclaveAssertionError("SMTP config was rejected by the egress policy", {
              violation: smtpEgressPolicyResult.violation,
              config: strippedEmailConfig,
            }));
            return Result.error({
              rawError: smtpEgressPolicyResult.violation,
              errorType: 'EGRESS_POLICY_REJECTED',
              canRetry: false,
              message: 'The email server host or port is not allowed. Please use a public SMTP server on a standard SMTP port.',
            } as const);
          }
          // Pin the connection to a validated address so nodemailer can't re-resolve the hostname to an
          // internal IP after our check (DNS rebinding); keep the hostname as the TLS SNI/cert name.
          connectHost = smtpEgressPolicyResult.connectHost;
          connectServername = smtpEgressPolicyResult.servername ?? undefined;
        }

        const transporter = nodemailer.createTransport({
          host: connectHost,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          ...(connectServername != null ? { servername: connectServername } : {}),
          disableFileAccess: true,
          disableUrlAccess: true,
          connectionTimeout: 15000,
          greetingTimeout: 10000,
          socketTimeout: 20000,
          dnsTimeout: 7000,
          auth: {
            user: smtpConfig.username,
            pass: smtpConfig.password,
          },
        });

        try {
          await transporter.sendMail({
            from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
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

          // nodemailer surfaces a refused connection as code 'ESOCKET' with 'ECONNREFUSED' in the message.
          // Safe to retry: the connection was refused before any SMTP exchange, so the message was never
          // handed off — there's no duplicate-delivery risk, and a transient refusal (server restarting /
          // overloaded) can recover. A persistent misconfig still fails after MAX_SEND_ATTEMPTS.
          if (code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
            return Result.error({
              rawError: error,
              errorType: 'CONNECTION_REFUSED',
              canRetry: true,
              message: 'The email server refused the connection. Please make sure the email host and port configuration are correct.',
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
          // 4yz error codes are considered temporary errors in SMTP, so they should be retried anyway
          // This is fallback logic for a code we don't explicitly capture but should still be retryable and we have the code
          if (is4yzSMTPResponseCode(responseCode)) {
            return Result.error({
              rawError: error,
              errorType: 'TRANSIENT_NEGATIVE_COMPLETION_REPLY',
              canRetry: true,
              message: 'The email server returned a temporary error. Please try again later.' + getServerResponse(error),
            } as const);
          }
        }

        // ============ temporary error ============
        const temporaryErrorIndicators = [
          "450 ",
          "Client network socket disconnected before secure TLS connection was established",
          "Too many requests",
          ...smtpConfig.host.includes("resend") ? [
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
        captureError("unknown-email-send-error", new HexclaveAssertionError("Unknown error while sending email. We should add a better error description for the user.", { strippedEmailConfig, cause: error }));
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

/**
 * Sends through a provider's HTTP API (Resend, useSend). Classified the same way as the SMTP path:
 * `canRetry` is reserved for failures that are plausibly transient, because the caller retries on it.
 */
async function sendEmailOverHttp(
  options: LowLevelSendEmailOptions,
  config: HttpEmailConfig,
  toArray: string[],
  strippedEmailConfig: unknown,
): Promise<Result<undefined, { rawError: any, errorType: string, canRetry: boolean, message?: string }>> {
  // Only tenant-provided ("standard") configs are attacker-controlled. A self-hosted provider's base
  // URL is a full URL the tenant chooses, so it is exactly the kind of value that turns an outbound
  // request into a forgery primitive if left unchecked.
  if (config.type === 'standard' && shouldEnforceHttpEmailEgressPolicy()) {
    const egressResult = await checkHttpEmailEgressPolicy({ baseUrl: config.baseUrl });
    if (egressResult.status === "error") {
      captureError("email-http-egress-policy-rejected", new HexclaveAssertionError("HTTP email provider config was rejected by the egress policy", {
        violation: egressResult.violation,
        config: strippedEmailConfig,
      }));
      return Result.error({
        rawError: egressResult.violation,
        errorType: 'EGRESS_POLICY_REJECTED',
        canRetry: false,
        message: 'The email provider base URL is not allowed. Please use a public HTTPS endpoint.',
      } as const);
    }
  }

  let response: Response;
  try {
    response = await fetch(httpProviderSendUrl(config), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        // Both providers honour this. Without it a retried 5xx can deliver the same email twice.
        ...(options.idempotencyKey != null ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: `${config.senderName} <${config.senderEmail}>`,
        to: toArray,
        subject: options.subject,
        ...(options.html != null ? { html: options.html } : {}),
        ...(options.text != null ? { text: options.text } : {}),
      }),
      signal: AbortSignal.timeout(HTTP_SEND_TIMEOUT_MS),
    });
  } catch (error) {
    // Nothing was accepted — the request never completed — so retrying cannot duplicate a delivery.
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return Result.error({
      rawError: error,
      errorType: isTimeout ? 'TIMEOUT' : 'CONNECTION_FAILED',
      canRetry: true,
      message: isTimeout
        ? 'The email provider timed out while sending the email. Please try again later.'
        : 'Failed to reach the email provider. Please make sure the provider base URL is correct.',
    } as const);
  }

  if (response.ok) {
    return Result.ok(undefined);
  }

  // Body is read for the error message only; providers return a short JSON error object here.
  const responseBody = await response.text().catch(() => '');
  const truncatedBody = responseBody.slice(0, 500);
  const rawError = new Error(`Email provider responded with HTTP ${response.status}: ${truncatedBody}`);

  if (response.status === 401 || response.status === 403) {
    return Result.error({
      rawError,
      errorType: 'AUTH_FAILED',
      canRetry: false,
      message: 'The email provider rejected the API key. Please check your email provider credentials.',
    } as const);
  }

  if (response.status === 429) {
    return Result.error({
      rawError,
      errorType: 'TEMPORARY',
      canRetry: true,
      message: 'The email provider rate-limited the request. Please try again later.',
    } as const);
  }

  if (response.status >= 500) {
    // Ambiguous: the provider may already have queued the message. Retried anyway, because a
    // provider blip is the common case and both providers de-duplicate on Idempotency-Key — which
    // is why callers that retry should always set one.
    return Result.error({
      rawError,
      errorType: 'TEMPORARY',
      canRetry: true,
      message: 'The email provider returned a server error. Please try again later.',
    } as const);
  }

  if (response.status === 422 || response.status === 400) {
    return Result.error({
      rawError,
      errorType: 'REJECTED',
      canRetry: false,
      message: `The email provider rejected the email. Please check the sender address and provider configuration.\n\nError: ${truncatedBody}`,
    } as const);
  }

  captureError("unknown-email-http-send-error", new HexclaveAssertionError("Unhandled status from HTTP email provider. We should add a better error description for the user.", {
    status: response.status,
    body: truncatedBody,
    config: strippedEmailConfig,
  }));
  return Result.error({
    rawError,
    errorType: 'UNKNOWN',
    canRetry: false,
    message: 'An unknown error occurred while sending the email.',
  } as const);
}

export async function lowLevelSendEmailDirectWithoutRetries(options: LowLevelSendEmailOptions): Promise<Result<undefined, {
  rawError: any,
  errorType: string,
  canRetry: boolean,
  message?: string,
}>> {
  if (!options.to) {
    throw new HexclaveAssertionError("No recipient email address provided to sendEmail", omit(options, ['emailConfig']));
  }

  const result = await _lowLevelSendEmailWithoutRetries(options);

  if (result.status === 'error') {
    console.warn("Failed to send email.", {
      destination: options.emailConfig.transport === 'smtp'
        ? options.emailConfig.host
        : `${options.emailConfig.provider} (${options.emailConfig.baseUrl})`,
      from: options.emailConfig.senderEmail,
      to: options.to,
      subject: options.subject,
      error: result.error,
    }, result.error.rawError);
  }

  return result;
}

import.meta.vitest?.describe("HTTP email providers", () => {
  const { vi, test, beforeEach, expect } = import.meta.vitest!;

  const httpConfig = (overrides: Partial<HttpEmailConfig> = {}): HttpEmailConfig => ({
    transport: 'http',
    provider: 'resend',
    apiKey: 'test_api_key',
    baseUrl: 'https://api.resend.com',
    senderEmail: 'sender@example.com',
    senderName: 'Example',
    type: 'standard',
    ...overrides,
  });

  const send = (config: HttpEmailConfig, extra: Partial<LowLevelSendEmailOptions> = {}) =>
    lowLevelSendEmailDirectWithoutRetries({
      tenancyId: 'tenancy-id',
      emailConfig: config,
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      ...extra,
    });

  const stubFetch = (response: Response | Error) => {
    const fetchMock = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  beforeEach(() => {
    // The egress policy is inert under NODE_ENV=test, which is what lets these tests point at
    // arbitrary base URLs without a DNS round-trip.
    vi.stubEnv("NODE_ENV", "test");
    return () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    };
  });

  test("resolves each provider's send URL", () => {
    expect(httpProviderSendUrl({ provider: 'resend', baseUrl: 'https://api.resend.com' }))
      .toBe('https://api.resend.com/emails');
    expect(httpProviderSendUrl({ provider: 'usesend', baseUrl: 'https://send.example.com' }))
      .toBe('https://send.example.com/api/v1/emails');
  });

  test("tolerates a base URL with a trailing slash", () => {
    // Operators paste their instance URL by hand, so a trailing slash is common and must not
    // produce a double slash that some routers 404 on.
    expect(httpProviderSendUrl({ provider: 'usesend', baseUrl: 'https://send.example.com/' }))
      .toBe('https://send.example.com/api/v1/emails');
  });

  test("defaults the base URL for Resend but not for useSend", () => {
    // useSend has no public instance to fall back to, so omitting its base URL must stay an error
    // rather than silently sending somewhere else.
    expect(resolveHttpProviderBaseUrl('resend', undefined)).toBe('https://api.resend.com');
    expect(resolveHttpProviderBaseUrl('usesend', undefined)).toBe(undefined);
    expect(resolveHttpProviderBaseUrl('resend', 'https://custom.example.com')).toBe('https://custom.example.com');
  });

  test("posts the expected request for a successful send", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ id: 'email-id' }), { status: 200 }));
    const result = await send(httpConfig(), { idempotencyKey: 'outbox-row-id' });

    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test_api_key');
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('outbox-row-id');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Example <sender@example.com>',
      to: ['recipient@example.com'],
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  test("omits the idempotency header when the caller has no stable key", async () => {
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));
    await send(httpConfig());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(undefined);
  });

  test("sends through useSend's path when that provider is configured", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ emailId: 'x' }), { status: 200 }));
    const result = await send(httpConfig({ provider: 'usesend', baseUrl: 'https://send.example.com' }));
    expect(result.status).toBe('ok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://send.example.com/api/v1/emails');
  });

  test("treats a rejected API key as permanent", async () => {
    // Retrying a bad credential just burns the outbox's attempt budget.
    stubFetch(new Response('unauthorized', { status: 401 }));
    const result = await send(httpConfig());
    expect(result).toMatchObject({ status: 'error', error: { errorType: 'AUTH_FAILED', canRetry: false } });
  });

  test("treats rate limiting and server errors as retryable", async () => {
    stubFetch(new Response('slow down', { status: 429 }));
    await expect(send(httpConfig())).resolves.toMatchObject({ status: 'error', error: { errorType: 'TEMPORARY', canRetry: true } });

    stubFetch(new Response('boom', { status: 503 }));
    await expect(send(httpConfig())).resolves.toMatchObject({ status: 'error', error: { errorType: 'TEMPORARY', canRetry: true } });
  });

  test("treats a rejected payload as permanent", async () => {
    stubFetch(new Response('{"message":"invalid from address"}', { status: 422 }));
    const result = await send(httpConfig());
    expect(result).toMatchObject({ status: 'error', error: { errorType: 'REJECTED', canRetry: false } });
  });

  test("treats an unreachable provider as retryable", async () => {
    // The request never completed, so a retry cannot duplicate a delivery.
    stubFetch(new TypeError('fetch failed'));
    const result = await send(httpConfig());
    expect(result).toMatchObject({ status: 'error', error: { errorType: 'CONNECTION_FAILED', canRetry: true } });
  });

  test("keeps the API key out of the error report", async () => {
    // strippedEmailConfig is what reaches Sentry; a leaked provider key there would be as bad as
    // leaking the SMTP password the SMTP path is careful to drop.
    const captured: unknown[] = [];
    stubFetch(new Response('teapot', { status: 418 }));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
    await send(httpConfig());
    consoleWarn.mockRestore();
    expect(JSON.stringify(captured)).not.toContain('test_api_key');
  });
});
