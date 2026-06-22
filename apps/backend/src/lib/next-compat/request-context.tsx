import { AsyncLocalStorage } from "node:async_hooks";

export type CookieWrite = {
  name: string,
  value: string,
  options: ResponseCookieOptions,
};

export type ResponseCookieOptions = {
  domain?: string,
  expires?: Date | number | string,
  httpOnly?: boolean,
  maxAge?: number,
  path?: string,
  priority?: "low" | "medium" | "high",
  sameSite?: boolean | "lax" | "strict" | "none",
  secure?: boolean,
};

export type RequestContext = {
  headers: Headers,
  incomingCookies: Map<string, string>,
  pendingSetCookies: CookieWrite[],
  deletedCookies: CookieWrite[],
};

export const requestContextALS = new AsyncLocalStorage<RequestContext>();

export function getRequestContext() {
  const context = requestContextALS.getStore();
  if (context == null) {
    throw new Error("next-compat request context is only available while handling a backend request");
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
