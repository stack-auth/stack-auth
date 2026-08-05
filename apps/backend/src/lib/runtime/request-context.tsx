import { AsyncLocalStorage } from "node:async_hooks";

export type CookieWrite = {
  name: string,
  value: string,
  options: ResponseCookieOptions,
};

export type ResponseCookieOptions = {
  expires?: Date,
  httpOnly?: boolean,
  maxAge?: number,
  path?: string,
  secure?: boolean,
};

export type RequestContext = {
  headers: Headers,
  incomingCookies: Map<string, string>,
  pendingSetCookies: CookieWrite[],
  deletedCookies: CookieWrite[],
  /**
   * The matched route pattern (e.g. `/api/latest/users/[user_id]`), NOT the concrete
   * request path. Concrete paths must not be logged or sent to Sentry in production
   * because their params can contain customer identifiers; the pattern carries no
   * customer data, so observability code may use it freely.
   */
  normalizedPath: string,
};

export const requestContextALS = new AsyncLocalStorage<RequestContext>();

export function getRequestContext() {
  const context = requestContextALS.getStore();
  if (context == null) {
    throw new Error("Backend request context is only available while handling a backend request");
  }
  return context;
}

export function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  if (cookieHeader == null || cookieHeader === "") {
    return cookies;
  }
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    if (name === "") {
      continue;
    }
    const rawValue = part.slice(separatorIndex + 1).trim();
    cookies.set(name, rawValue);
  }
  return cookies;
}
