import { AsyncLocalStorage } from "node:async_hooks";

export type StackNextUrl = URL & {
  clone: () => URL,
};

export type StackNextRequest = Request & {
  nextUrl: StackNextUrl,
};

type RequestContext = {
  request: StackNextRequest,
  responseHeaders: Headers,
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export class StackRedirectError extends Error {
  readonly response: Response;

  constructor(url: string, status: 303 | 307 | 308 = 307) {
    super(`Redirect to ${url}`);
    this.name = "StackRedirectError";
    this.response = new Response(null, {
      status,
      headers: {
        location: url,
      },
    });
  }
}

export function isStackRedirectError(error: unknown): error is StackRedirectError {
  return error instanceof StackRedirectError;
}

export function redirect(url: string): never {
  throw new StackRedirectError(url);
}

export function toStackNextRequest(request: Request): StackNextRequest {
  if (hasNextUrl(request)) {
    return request;
  }

  let nextUrl: StackNextUrl;
  nextUrl = Object.assign(new URL(request.url), {
    clone: () => new URL(nextUrl.toString()),
  });

  return Object.assign(request, { nextUrl });
}

function hasNextUrl(request: Request): request is StackNextRequest {
  return "nextUrl" in request;
}

export async function runWithRequestContext<T>(
  request: StackNextRequest,
  callback: () => Promise<T>,
): Promise<{ result: T, responseHeaders: Headers }> {
  const context = {
    request,
    responseHeaders: new Headers(),
  };
  const result = await requestContextStorage.run(context, callback);
  return {
    result,
    responseHeaders: context.responseHeaders,
  };
}

function getCurrentRequestContext(): RequestContext {
  const context = requestContextStorage.getStore();
  if (!context) {
    throw new Error("No current request context is available");
  }
  return context;
}

export async function headers(): Promise<Headers> {
  return getCurrentRequestContext().request.headers;
}

type CookieOptions = {
  httpOnly?: boolean,
  secure?: boolean,
  maxAge?: number,
  path?: string,
  sameSite?: "strict" | "lax" | "none",
};

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (!rawName) {
      continue;
    }
    cookies.set(rawName, rawValueParts.join("="));
  }
  return cookies;
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.maxAge != null) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

export async function cookies() {
  const context = getCurrentRequestContext();
  const parsedCookies = parseCookieHeader(context.request.headers.get("cookie"));

  return {
    get(name: string) {
      const value = parsedCookies.get(name);
      return value == null ? undefined : { name, value };
    },
    set(name: string, value: string, options?: CookieOptions) {
      context.responseHeaders.append("set-cookie", serializeCookie(name, value, options));
    },
    delete(name: string) {
      context.responseHeaders.append("set-cookie", serializeCookie(name, "", { maxAge: 0 }));
    },
  };
}
