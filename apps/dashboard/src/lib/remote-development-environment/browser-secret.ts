import "server-only";

/**
 * Browser access to the development-environment dashboard is capability-based.
 *
 * The dashboard process may listen on 0.0.0.0 so SSH tunnels, Codespaces-style
 * preview URLs, and other forwarding setups can reach it. Because hostnames and
 * origins are request metadata rather than authentication, browser-only
 * endpoints require a high-entropy secret in an HttpOnly cookie. Each issued
 * secret is pinned to the browser page host that requested it; requests with a
 * different Host header, or with an Origin that does not match the pinned origin,
 * are treated exactly like requests with no secret.
 *
 * There are two bootstrap paths:
 * - Simple local browser use asks this module to start a one-shot helper server
 *   bound to 127.0.0.1 on an available port. The helper checks loopback Host,
 *   the pinned Origin, and an unguessable helper token before returning a
 *   browser secret.
 * - Forwarded/public browser use asks the running CLI to show a short-lived
 *   confirmation code. Submitting the correct code returns a browser secret.
 *
 * JavaScript never stores the long-lived browser capability directly. It only
 * relays a freshly issued secret to the same-origin store endpoint, which sets
 * the HttpOnly cookie.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createServer, type Server } from "http";
import { NextRequest, NextResponse } from "next/server";
import { createUrlIfValid, isLocalhost } from "@hexclave/shared/dist/utils/urls";
import {
  REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_COOKIE_NAME,
  REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_ERROR_HEADER,
  REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE,
} from "./browser-secret-common";
import { isRemoteDevelopmentEnvironmentEnabled } from "./env";
import { readRemoteDevelopmentEnvironmentState, updateRemoteDevelopmentEnvironmentState } from "./state";

const BROWSER_SECRET_RATE_LIMIT_MAX_REQUESTS = 50;
const BROWSER_SECRET_RATE_LIMIT_WINDOW_MS = 10_000;
const BROWSER_SECRET_BYTES = 32;
const LOCALBOUND_HELPER_TOKEN_BYTES = 24;
const LOCALBOUND_HELPER_TTL_MS = 60_000;
const BROWSER_SECRET_TTL_MS = 12 * 60 * 60 * 1000;
const CONFIRMATION_CODE_TTL_MS = 2 * 60 * 1000;
const CONFIRMATION_CODE_MAX_ATTEMPTS = 8;
const CONFIRMATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type IssuedBrowserSecret = {
  host: string,
  origin: string,
  expiresAtMs: number,
};

type LocalboundHelperState = {
  server: Server,
  port: number,
  helperToken: string,
  targetOrigin: string,
  targetHost: string,
  expiresAtMs: number,
};

type ConfirmationCodeState = {
  code: string,
  targetOrigin: string,
  targetHost: string,
  expiresAtMs: number,
  attempts: number,
  shownByCli: boolean,
};

type BrowserSecretGlobals = {
  issuedSecretsByHash: Map<string, IssuedBrowserSecret>,
  localboundHelper?: LocalboundHelperState,
  confirmationCode?: ConfirmationCodeState,
  rateLimitTimestamps: number[],
};

const browserSecretGlobals = globalThis as typeof globalThis & {
  __stackRemoteDevelopmentEnvironmentBrowserSecret?: BrowserSecretGlobals,
};

function getGlobals(): BrowserSecretGlobals {
  browserSecretGlobals.__stackRemoteDevelopmentEnvironmentBrowserSecret ??= {
    issuedSecretsByHash: new Map(),
    rateLimitTimestamps: [],
  };
  return browserSecretGlobals.__stackRemoteDevelopmentEnvironmentBrowserSecret;
}

function nowMs(): number {
  return performance.now();
}

function unixNowMs(): number {
  return Date.now();
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function stringsEqualConstantTime(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requestHost(req: NextRequest): string | null {
  const host = req.headers.get("host");
  return host == null || host.length === 0 ? null : host;
}

function requestProtocol(req: NextRequest): "http" | "https" {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedProto === "https") return "https";
  if (forwardedProto === "http") return "http";
  return createUrlIfValid(req.url)?.protocol === "https:" ? "https" : "http";
}

function requestHostOrigin(req: NextRequest): string | null {
  const host = requestHost(req);
  if (host == null) return null;
  return `${requestProtocol(req)}://${host}`;
}

function requestHostPort(req: NextRequest): string | null {
  const host = requestHost(req);
  if (host == null) return null;
  const parsed = createUrlIfValid(`http://${host}`);
  return parsed?.port.length ? parsed.port : null;
}

function urlOrigin(value: string | null): string | null {
  if (value == null || value.length === 0) return null;
  return createUrlIfValid(value)?.origin ?? null;
}

function expectedRequestOrigin(req: NextRequest): string | null {
  return urlOrigin(req.headers.get("origin")) ?? requestHostOrigin(req);
}

function requestMatchesPinnedHost(req: NextRequest, pin: { host: string, origin: string }): boolean {
  const host = requestHost(req);
  if (host !== pin.host) return false;

  const origin = req.headers.get("origin");
  if (origin != null && urlOrigin(origin) !== pin.origin) return false;

  return true;
}

function requestLooksSameOrigin(req: NextRequest): boolean {
  const hostOrigin = requestHostOrigin(req);
  if (hostOrigin == null) return false;

  const origin = req.headers.get("origin");
  if (origin != null && urlOrigin(origin) !== hostOrigin) return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  return fetchSite == null || fetchSite === "same-origin" || fetchSite === "none";
}

function hasActiveLocalDashboard(): boolean {
  const state = readRemoteDevelopmentEnvironmentState();
  return Object.values(state.localDashboardsByPort ?? {})
    .some((dashboard) => dashboard != null && dashboard.secret.length > 0);
}

export function rateLimitRemoteDevelopmentEnvironmentBrowserSecret(): NextResponse | null {
  if (takeRemoteDevelopmentEnvironmentBrowserSecretRateLimitSlot()) return null;
  return NextResponse.json({ error: "Too many development environment browser-secret requests." }, { status: 429 });
}

function takeRemoteDevelopmentEnvironmentBrowserSecretRateLimitSlot(): boolean {
  const globals = getGlobals();
  const now = nowMs();
  while (globals.rateLimitTimestamps.length > 0 && now - globals.rateLimitTimestamps[0] > BROWSER_SECRET_RATE_LIMIT_WINDOW_MS) {
    globals.rateLimitTimestamps.shift();
  }
  if (globals.rateLimitTimestamps.length >= BROWSER_SECRET_RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  globals.rateLimitTimestamps.push(now);
  return true;
}

export function remoteDevelopmentEnvironmentBrowserSecretInvalidResponse(): NextResponse {
  const response = NextResponse.json({
    code: REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE,
    error: "The development environment browser secret is missing or invalid.",
  }, {
    status: 401,
    headers: {
      [REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_ERROR_HEADER]: REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE,
    },
  });
  response.cookies.delete(REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_COOKIE_NAME);
  return response;
}

export function assertRemoteDevelopmentEnvironmentBrowserSecret(req: NextRequest): NextResponse | null {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    return NextResponse.json({ error: "Remote development environment endpoints are disabled." }, { status: 404 });
  }
  if (!hasActiveLocalDashboard()) {
    return NextResponse.json({ error: "Remote development environment is not active." }, { status: 404 });
  }

  const secret = req.cookies.get(REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_COOKIE_NAME)?.value;
  if (secret == null || secret.length === 0) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  const globals = getGlobals();
  const issued = globals.issuedSecretsByHash.get(hashSecret(secret));
  if (issued == null || unixNowMs() > issued.expiresAtMs || !requestMatchesPinnedHost(req, issued)) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite != null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  return null;
}

export function assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req: NextRequest): NextResponse | null {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    return NextResponse.json({ error: "Remote development environment endpoints are disabled." }, { status: 404 });
  }
  if (!hasActiveLocalDashboard()) {
    return NextResponse.json({ error: "Remote development environment is not active." }, { status: 404 });
  }
  const rateLimitResponse = rateLimitRemoteDevelopmentEnvironmentBrowserSecret();
  if (rateLimitResponse != null) return rateLimitResponse;
  if (!requestLooksSameOrigin(req)) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }
  return null;
}

function issueBrowserSecret(target: { host: string, origin: string }): string {
  const secret = randomBase64Url(BROWSER_SECRET_BYTES);
  getGlobals().issuedSecretsByHash.set(hashSecret(secret), {
    host: target.host,
    origin: target.origin,
    expiresAtMs: unixNowMs() + BROWSER_SECRET_TTL_MS,
  });
  return secret;
}

function updatePendingConfirmationCodeForCli(req: NextRequest, code: ConfirmationCodeState | undefined): void {
  const port = requestHostPort(req);
  if (port == null) return;
  updateRemoteDevelopmentEnvironmentState((state) => {
    const nextPending = { ...state.pendingBrowserSecretConfirmationCodesByPort };
    if (code == null || unixNowMs() > code.expiresAtMs) {
      delete nextPending[port];
    } else {
      nextPending[port] = {
        code: code.code,
        expiresAtMillis: code.expiresAtMs,
        updatedAtMillis: unixNowMs(),
      };
    }
    return {
      ...state,
      pendingBrowserSecretConfirmationCodesByPort: nextPending,
    };
  });
}

function browserSecretCookieIsSecure(req: NextRequest): boolean {
  return requestProtocol(req) === "https";
}

export function storeRemoteDevelopmentEnvironmentBrowserSecret(req: NextRequest, secret: string): NextResponse {
  const issued = getGlobals().issuedSecretsByHash.get(hashSecret(secret));
  if (issued == null || unixNowMs() > issued.expiresAtMs || !requestMatchesPinnedHost(req, issued)) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_COOKIE_NAME, secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: browserSecretCookieIsSecure(req),
    path: "/",
    expires: new Date(issued.expiresAtMs),
  });
  return response;
}

function localboundRequestHostIsLoopback(host: string | string[] | undefined): boolean {
  if (Array.isArray(host) || host == null || host.length === 0) return false;
  return isLocalhost(`http://${host}`);
}

function stopExpiredLocalboundHelper(): void {
  const helper = getGlobals().localboundHelper;
  if (helper == null || unixNowMs() <= helper.expiresAtMs) return;
  helper.server.close();
  getGlobals().localboundHelper = undefined;
}

export async function startRemoteDevelopmentEnvironmentBrowserSecretLocalboundServer(req: NextRequest): Promise<NextResponse> {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req);
  if (securityResponse != null) return securityResponse;

  const targetHost = requestHost(req);
  const targetOrigin = expectedRequestOrigin(req);
  if (targetHost == null || targetOrigin == null) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  stopExpiredLocalboundHelper();
  const existing = getGlobals().localboundHelper;
  if (existing != null && existing.targetHost === targetHost && existing.targetOrigin === targetOrigin) {
    return NextResponse.json({ url: `http://127.0.0.1:${existing.port}/browser-secret?token=${encodeURIComponent(existing.helperToken)}` });
  }
  if (existing != null) {
    existing.server.close();
    getGlobals().localboundHelper = undefined;
  }

  const helperToken = randomBase64Url(LOCALBOUND_HELPER_TOKEN_BYTES);
  const expiresAtMs = unixNowMs() + LOCALBOUND_HELPER_TTL_MS;
  const server = createServer((request, response) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : null;
    const allowCors = origin != null && urlOrigin(origin) === targetOrigin;
    if (allowCors) {
      response.setHeader("Access-Control-Allow-Origin", targetOrigin);
      response.setHeader("Vary", "Origin");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (request.method === "OPTIONS") {
      response.statusCode = allowCors ? 204 : 403;
      response.end();
      return;
    }

    const parsedUrl = createUrlIfValid(request.url ?? "", "http://127.0.0.1");
    const requestToken = parsedUrl?.searchParams.get("token");
    const rateLimitAllowed = takeRemoteDevelopmentEnvironmentBrowserSecretRateLimitSlot();
    const allowed = (
      rateLimitAllowed &&
      request.method === "GET" &&
      parsedUrl?.pathname === "/browser-secret" &&
      allowCors &&
      localboundRequestHostIsLoopback(request.headers.host) &&
      requestToken != null &&
      stringsEqualConstantTime(requestToken, helperToken) &&
      unixNowMs() <= expiresAtMs
    );

    if (!allowed) {
      response.statusCode = 403;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: "Unauthorized." }));
      return;
    }

    const browserSecret = issueBrowserSecret({ host: targetHost, origin: targetOrigin });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify({ browser_secret: browserSecret }), () => {
      // One-shot: shut down the helper after successfully issuing a secret.
      server.close();
      getGlobals().localboundHelper = undefined;
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address == null || typeof address === "string") {
    server.close();
    throw new Error("Localbound browser-secret server did not report a TCP port.");
  }

  server.unref();
  getGlobals().localboundHelper = {
    server,
    port: address.port,
    helperToken,
    targetOrigin,
    targetHost,
    expiresAtMs,
  };

  return NextResponse.json({ url: `http://127.0.0.1:${address.port}/browser-secret?token=${encodeURIComponent(helperToken)}` });
}

function randomConfirmationCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CONFIRMATION_CODE_ALPHABET[randomBytes(1)[0] % CONFIRMATION_CODE_ALPHABET.length];
  }
  return code;
}

export function initRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode(req: NextRequest): NextResponse {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req);
  if (securityResponse != null) return securityResponse;

  const targetHost = requestHost(req);
  const targetOrigin = expectedRequestOrigin(req);
  if (targetHost == null || targetOrigin == null) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  const existing = getGlobals().confirmationCode;
  if (
    existing != null &&
    unixNowMs() <= existing.expiresAtMs &&
    existing.attempts < CONFIRMATION_CODE_MAX_ATTEMPTS &&
    existing.targetHost === targetHost &&
    existing.targetOrigin === targetOrigin
  ) {
    updatePendingConfirmationCodeForCli(req, existing);
    return NextResponse.json({ expires_at_millis: existing.expiresAtMs });
  }

  const code = randomConfirmationCode();
  const expiresAtMs = unixNowMs() + CONFIRMATION_CODE_TTL_MS;
  getGlobals().confirmationCode = {
    code,
    targetHost,
    targetOrigin,
    expiresAtMs,
    attempts: 0,
    shownByCli: false,
  };
  updatePendingConfirmationCodeForCli(req, getGlobals().confirmationCode);
  return NextResponse.json({ expires_at_millis: expiresAtMs });
}

export function submitRemoteDevelopmentEnvironmentBrowserSecretConfirmationCode(req: NextRequest, code: string): NextResponse {
  const securityResponse = assertRemoteDevelopmentEnvironmentBrowserSecretSetupRequest(req);
  if (securityResponse != null) return securityResponse;

  const targetHost = requestHost(req);
  const targetOrigin = expectedRequestOrigin(req);
  const confirmationCode = getGlobals().confirmationCode;
  if (
    confirmationCode == null ||
    targetHost == null ||
    targetOrigin == null ||
    unixNowMs() > confirmationCode.expiresAtMs ||
    confirmationCode.targetHost !== targetHost ||
    confirmationCode.targetOrigin !== targetOrigin
  ) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  confirmationCode.attempts += 1;
  if (
    confirmationCode.attempts > CONFIRMATION_CODE_MAX_ATTEMPTS ||
    !stringsEqualConstantTime(code.toUpperCase(), confirmationCode.code)
  ) {
    return remoteDevelopmentEnvironmentBrowserSecretInvalidResponse();
  }

  getGlobals().confirmationCode = undefined;
  updatePendingConfirmationCodeForCli(req, undefined);
  return NextResponse.json({
    browser_secret: issueBrowserSecret({ host: confirmationCode.targetHost, origin: confirmationCode.targetOrigin }),
  });
}

export function peekRemoteDevelopmentEnvironmentBrowserSecretConfirmationCodeForCli(): { code: string, expiresAtMillis: number } | null {
  const confirmationCode = getGlobals().confirmationCode;
  if (confirmationCode == null || unixNowMs() > confirmationCode.expiresAtMs) {
    return null;
  }
  // Non-destructive: always return the code so retried/timed-out heartbeats
  // can still deliver it. The CLI deduplicates display locally.
  confirmationCode.shownByCli = true;
  return {
    code: confirmationCode.code,
    expiresAtMillis: confirmationCode.expiresAtMs,
  };
}
