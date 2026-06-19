import { getRequestContext, ResponseCookieOptions } from "./request-context";

type CookieSetObject = ResponseCookieOptions & {
  name: string,
  value: string,
};

type CookieDeleteObject = {
  name: string,
};

function encodeCookieComponent(value: string) {
  return encodeURIComponent(value);
}

function normalizeSameSite(sameSite: ResponseCookieOptions["sameSite"]) {
  if (sameSite === true) {
    return "Strict";
  }
  if (sameSite === "lax") {
    return "Lax";
  }
  if (sameSite === "strict") {
    return "Strict";
  }
  if (sameSite === "none") {
    return "None";
  }
  return undefined;
}

export function serializeSetCookie(name: string, value: string, options: ResponseCookieOptions = {}) {
  const parts = [`${encodeCookieComponent(name)}=${encodeCookieComponent(value)}`];

  if (options.domain != null) {
    parts.push(`Domain=${options.domain}`);
  }
  parts.push(`Path=${options.path ?? "/"}`);
  const expires = options.expires != null
    ? options.expires instanceof Date ? options.expires : new Date(options.expires)
    : options.maxAge != null ? new Date(Date.now() + options.maxAge * 1000) : undefined;
  if (expires != null) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  if (options.httpOnly === true) {
    parts.push("HttpOnly");
  }
  if (options.secure === true) {
    parts.push("Secure");
  }

  const sameSite = normalizeSameSite(options.sameSite);
  if (sameSite != null) {
    parts.push(`SameSite=${sameSite}`);
  }
  if (options.priority != null) {
    parts.push(`Priority=${options.priority}`);
  }

  return parts.join("; ");
}

export async function headers() {
  return getRequestContext().headers;
}

export async function cookies() {
  const context = getRequestContext();

  return {
    get(name: string) {
      const pending = [...context.pendingSetCookies].reverse().find(cookie => cookie.name === name);
      if (pending != null) {
        return {
          name,
          value: pending.value,
        };
      }

      const value = context.incomingCookies.get(name);
      return value == null ? undefined : {
        name,
        value,
      };
    },

    set(nameOrCookie: string | CookieSetObject, value?: string, options?: ResponseCookieOptions) {
      const cookie = typeof nameOrCookie === "string"
        ? {
          name: nameOrCookie,
          value: value ?? "",
          options: options ?? {},
        }
        : {
          name: nameOrCookie.name,
          value: nameOrCookie.value,
          options: nameOrCookie,
        };

      context.pendingSetCookies.push(cookie);
      context.incomingCookies.set(cookie.name, cookie.value);
    },

    delete(nameOrCookie: string | CookieDeleteObject) {
      const name = typeof nameOrCookie === "string" ? nameOrCookie : nameOrCookie.name;
      const cookie = {
        name,
        value: "",
        options: {
          expires: new Date(0),
          maxAge: 0,
          path: "/",
        },
      };
      context.deletedCookies.push(cookie);
      context.incomingCookies.delete(name);
    },
  };
}
