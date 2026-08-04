import { getRequestContext, ResponseCookieOptions } from "./request-context";

export function serializeSetCookie(name: string, value: string, options: ResponseCookieOptions = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);
  const expires = options.expires ?? (options.maxAge != null ? new Date(Date.now() + options.maxAge * 1000) : undefined);
  if (expires != null) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  }
  // Emit Secure before HttpOnly to match the attribute order the pre-ElysiaJS
  // (Next.js) backend produced. Cookie attribute order is semantically irrelevant
  // per RFC 6265, but the e2e suite asserts the exact Set-Cookie string for the
  // oauth-inner cookies (`...; Max-Age=N;( Secure;)? HttpOnly`), so keeping this
  // order avoids a spurious regression there.
  if (options.secure === true) {
    parts.push("Secure");
  }
  if (options.httpOnly === true) {
    parts.push("HttpOnly");
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
      // set()/delete() keep incomingCookies in sync, so it is the authoritative
      // read-view even for cookies written during this request.
      const value = context.incomingCookies.get(name);
      return value == null ? undefined : {
        name,
        value,
      };
    },

    set(name: string, value: string, options: ResponseCookieOptions = {}) {
      context.pendingSetCookies.push({ name, value, options });
      context.incomingCookies.set(name, value);
    },

    delete(name: string) {
      const cookie = {
        name,
        value: "",
        options: {
          expires: new Date(0),
          maxAge: 0,
          path: "/",
        },
      };
      context.pendingSetCookies = context.pendingSetCookies.filter(c => c.name !== name);
      context.deletedCookies.push(cookie);
      context.incomingCookies.delete(name);
    },
  };
}
