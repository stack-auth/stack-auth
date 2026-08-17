import type { SmartRequestAuth } from "@/route-handlers/smart-request";

export const FILTERED_VALUE = "[Filtered]";

type SafeContextValue = null | boolean | number | string | SafeContextValue[] | { [key: string]: SafeContextValue };

export type SafeRequestValueSummary = {
  type: "array" | "binary" | "boolean" | "null" | "number" | "object" | "string" | "undefined",
  length?: number,
  keys?: string[],
  keyCount?: number,
  itemCount?: number,
};

export type SafeRequestContext = {
  requestId: string,
  method: string,
  url: string,
  status?: number,
  queryParameterCount: number,
  headers: Record<string, string>,
  cookies: {
    names: string[],
  },
};

type SafeSmartRequestAuth = {
  authenticated: boolean,
  type?: SmartRequestAuth["type"],
  projectId?: string,
  branchId?: string,
  userId?: string,
  refreshTokenPresent: boolean,
};

export type SafeSmartRequestContext = SafeRequestContext & {
  query: SafeRequestValueSummary,
  params: SafeRequestValueSummary,
  auth: SafeSmartRequestAuth,
  clientVersion: SafeContextValue,
};

// Request metadata is allowlisted. In particular, authorization, cookies, and
// arbitrary x-* headers must never become error context merely because a new
// caller adds them to a request.
const SAFE_HEADER_NAMES = new Set([
  "accept",
  "content-length",
  "content-type",
  "host",
  "user-agent",
  "x-forwarded-proto",
  "x-stack-branch-id",
  "x-stack-client-version",
  "x-stack-project-id",
  "x-stack-request-id",
]);

// These key rules intentionally cover both the Sentry/Relay built-in password
// family and the credential names used by Hexclave's auth and telemetry APIs.
// Unknown keys are still bounded; they are not treated as safe credentials.
const SENSITIVE_KEY_PATTERN = /(?:access[-_.]?token|api[-_.]?key|authorization|client[-_.]?secret|cookie|credential|id[-_.]?token|password|passwd|private[-_.]?key|refresh[-_.]?token|secret|session(?:[-_.]?(?:id|key|token|value|secret))?|signing[-_.]?key|token)/i;
const PII_KEY_PATTERN = /(?:e[-_. ]?mail|phone|telephone|mobile|ip(?:v4|v6)?|street|address|city|postal|zip|ssn|social[-_. ]?security|date[-_. ]?of[-_. ]?birth|birth[-_. ]?date|first[-_. ]?name|last[-_. ]?name|full[-_. ]?name)/i;
const SENSITIVE_ASSIGNMENT_PATTERN = /((?:access[-_.]?token|api[-_.]?key|authorization|client[-_.]?secret|cookie|credential|id[-_.]?token|password|passwd|private[-_.]?key|refresh[-_.]?token|secret|session[-_.]?token|signing[-_.]?key|token)\s*[:=]\s*)(["']?)([^\s"'&,;}\]]+)\2/gi;
const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic|Digest)\s+[^\s,;]+/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_AUTH_PATTERN = /([a-z][a-z\d+.-]*:\/\/)(?:[^/@\s]+):(?:[^/@\s]+)@/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const MAX_CONTEXT_DEPTH = 8;
const MAX_CONTEXT_KEYS = 100;
const MAX_CONTEXT_ARRAY_ITEMS = 100;
const MAX_CONTEXT_STRING_LENGTH = 512;
const MAX_CONTEXT_TOTAL_CHARACTERS = 16_384;

type ScrubBudget = {
  remainingCharacters: number,
};

function scrubString(value: string, budget: ScrubBudget): string {
  const scrubbed = value
    .replace(PRIVATE_KEY_PATTERN, FILTERED_VALUE)
    .replace(AUTH_SCHEME_PATTERN, "$1 " + FILTERED_VALUE)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, "$1" + FILTERED_VALUE)
    .replace(JWT_PATTERN, FILTERED_VALUE)
    .replace(URL_AUTH_PATTERN, "$1" + FILTERED_VALUE + "@")
    .replace(EMAIL_PATTERN, FILTERED_VALUE);

  const availableCharacters = Math.min(MAX_CONTEXT_STRING_LENGTH, budget.remainingCharacters);
  if (availableCharacters <= 0) return "[Size limited]";

  const result = scrubbed.length > availableCharacters
    ? scrubbed.slice(0, Math.max(0, availableCharacters - 1)) + "…"
    : scrubbed;
  budget.remainingCharacters = Math.max(0, budget.remainingCharacters - result.length);
  return result;
}

function isObject(value: object): value is Record<string, unknown> {
  return !Array.isArray(value);
}

/**
 * Scrubs arbitrary structured values before they cross the error-context
 * boundary. This mirrors Relay's key-based PII processing for the default
 * credential families, adds the auth field names used by this backend, and
 * keeps recursion, object width, array width, and string size bounded.
 */
export function scrubContextValue(value: unknown, key = "", seen = new WeakSet<object>(), depth = 0, budget: ScrubBudget = { remainingCharacters: MAX_CONTEXT_TOTAL_CHARACTERS }): SafeContextValue {
  if (value == null) return null;
  if (SENSITIVE_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) return FILTERED_VALUE;

  if (typeof value === "string") return scrubString(value, budget);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : FILTERED_VALUE;
  if (typeof value !== "object") return FILTERED_VALUE;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_CONTEXT_DEPTH) return "[Depth limited]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value
        .slice(0, MAX_CONTEXT_ARRAY_ITEMS)
        .map(item => scrubContextValue(item, "", seen, depth + 1, budget));
      if (value.length > MAX_CONTEXT_ARRAY_ITEMS) result.push("[Items limited]");
      return result;
    }

    if (!isObject(value)) return FILTERED_VALUE;
    const result: { [key: string]: SafeContextValue } = {};
    for (const entryKey of Object.keys(value).sort().slice(0, MAX_CONTEXT_KEYS)) {
      budget.remainingCharacters = Math.max(0, budget.remainingCharacters - entryKey.length);
      const entryValue = value[entryKey];
      if (entryValue !== undefined) result[entryKey] = scrubContextValue(entryValue, entryKey, seen, depth + 1, budget);
    }
    if (Object.keys(value).length > MAX_CONTEXT_KEYS) result._truncated = "[Keys limited]";
    return result;
  } finally {
    seen.delete(value);
  }
}

function scrubHeaderValue(name: string, value: string): string {
  const scrubbed = scrubContextValue(value, name);
  return typeof scrubbed === "string" ? scrubbed : FILTERED_VALUE;
}

// Cookie NAMES are retained as presence diagnostics (their values are always
// discarded), but they are still caller-controlled request data: a client can
// send arbitrarily many cookies and can put value-shaped secrets (JWTs,
// emails, key material) into the name half of a pair. Bound the collection
// and run each name through the string scrubber so those bypasses close
// without hiding which legitimate cookies were present.
const MAX_COOKIE_NAMES = 50;

function decodeUriComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeHeadersFromEntries(entries: Iterable<readonly [string, string]>): { headers: Record<string, string>, cookieNames: string[] } {
  const headers: Record<string, string> = {};
  const cookieNames = new Set<string>();

  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (name === "cookie") {
      for (const cookie of rawValue.split(";")) {
        const cookieName = cookie.split("=", 1)[0]?.trim();
        if (cookieName !== "") {
          cookieNames.add(scrubString(decodeUriComponentSafely(cookieName), { remainingCharacters: MAX_CONTEXT_STRING_LENGTH }));
        }
      }
      continue;
    }
    if (SAFE_HEADER_NAMES.has(name)) headers[name] = scrubHeaderValue(name, rawValue);
  }

  const sortedCookieNames = [...cookieNames].sort();
  return {
    headers,
    cookieNames: sortedCookieNames.length > MAX_COOKIE_NAMES
      ? [...sortedCookieNames.slice(0, MAX_COOKIE_NAMES), "[Names limited]"]
      : sortedCookieNames,
  };
}

function safeUrlPath(url: string): { path: string, queryParameterCount: number } {
  try {
    const parsed = new URL(url);
    // Query values are request data, not safe route metadata. Keep only the
    // path and count so a useful route diagnostic survives without retaining
    // arbitrary user input in a Sentry scope. The path itself is still
    // caller-controlled — dynamic and catch-all segments can carry PII or
    // value-shaped secrets (emails, JWTs, tokens) — so it goes through the
    // same string scrubber and size bound as every other retained string.
    return {
      path: scrubString(decodeUriComponentSafely(parsed.pathname), { remainingCharacters: MAX_CONTEXT_STRING_LENGTH }),
      queryParameterCount: [...parsed.searchParams.keys()].length,
    };
  } catch {
    return { path: "[Invalid URL]", queryParameterCount: 0 };
  }
}

export function safeRequestPath(url: string): string {
  return safeUrlPath(url).path;
}

function summarizeRequestValue(value: unknown, depth = 0): SafeRequestValueSummary {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return { type: "binary", length: value.byteLength };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value !== "object") return { type: "undefined" };
  if (depth >= MAX_CONTEXT_DEPTH) return { type: "object", keyCount: MAX_CONTEXT_KEYS };

  if (Array.isArray(value)) return { type: "array", itemCount: value.length };

  const keys = Object.keys(value).sort();
  const safeKeys = keys
    .filter(key => !SENSITIVE_KEY_PATTERN.test(key) && !PII_KEY_PATTERN.test(key))
    .slice(0, MAX_CONTEXT_KEYS);
  return {
    type: "object",
    keys: safeKeys,
    keyCount: keys.length,
  };
}

export function createSafeRequestContext(input: { requestId: string, method: string, url: string, headers: Headers, status?: number }): SafeRequestContext {
  const safeHeaders = safeHeadersFromEntries(input.headers.entries());
  const safeUrl = safeUrlPath(input.url);
  return {
    requestId: input.requestId,
    method: input.method,
    url: safeUrl.path,
    ...(input.status === undefined ? {} : { status: input.status }),
    queryParameterCount: safeUrl.queryParameterCount,
    headers: safeHeaders.headers,
    cookies: { names: safeHeaders.cookieNames },
  };
}

type SafeSmartRequestInput = {
  auth: {
    project: { id: string },
    branchId: string,
    type: SmartRequestAuth["type"],
    user?: { id: string } | null,
    refreshTokenId?: string,
  } | null,
  url: string,
  method: string,
  headers: Record<string, string[] | undefined>,
  query: unknown,
  params: unknown,
  clientVersion: unknown,
};

export function createSafeSmartRequestContext(smartRequest: SafeSmartRequestInput, requestId: string): SafeSmartRequestContext {
  const headerEntries: Array<readonly [string, string]> = [];
  for (const [name, values] of Object.entries(smartRequest.headers)) {
    for (const value of values ?? []) headerEntries.push([name, value]);
  }
  const safeHeaders = safeHeadersFromEntries(headerEntries);
  const auth = smartRequest.auth;
  const safeUrl = safeUrlPath(smartRequest.url);

  return {
    requestId,
    method: smartRequest.method,
    url: safeUrl.path,
    queryParameterCount: safeUrl.queryParameterCount,
    headers: safeHeaders.headers,
    cookies: { names: safeHeaders.cookieNames },
    // Request values are intentionally summarized rather than retained. The
    // generic scrubber remains available for explicitly approved diagnostics;
    // a request body is not an approved diagnostic by default.
    query: summarizeRequestValue(smartRequest.query),
    params: summarizeRequestValue(smartRequest.params),
    auth: auth == null ? {
      authenticated: false,
      refreshTokenPresent: false,
    } : {
      authenticated: true,
      type: auth.type,
      projectId: auth.project.id,
      branchId: auth.branchId,
      userId: auth.user?.id,
      refreshTokenPresent: auth.refreshTokenId != null,
    },
    clientVersion: scrubContextValue(smartRequest.clientVersion),
  };
}

export function createSafeParsedRequestContext(value: unknown): { keys: string[] } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return { keys: [] };
  return { keys: Object.keys(value).sort().slice(0, MAX_CONTEXT_KEYS) };
}
