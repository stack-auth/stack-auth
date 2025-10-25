import { encodeBase32 } from "@stackframe/stack-shared/dist/utils/bytes";
import { TextEncoder } from "util";
import { vi } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

type BrowserEnvOptions = {
  host?: string,
  protocol?: "https:" | "http:",
};

type BrowserEnv = {
  cookieStore: Map<string, string>,
  cookieWrites: string[],
  location: {
    host: string,
    hostname: string,
    href: string,
    origin: string,
    protocol: string,
  },
};

function setupBrowserCookieEnv(options: BrowserEnvOptions = {}): BrowserEnv {
  const {
    host = "app.example.com",
    protocol = "https:",
  } = options;

  const cookieStore = new Map<string, string>();
  const cookieWrites: string[] = [];

  const fakeSessionStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  };

  const location = {
    host,
    hostname: host,
    href: `${protocol}//${host}/`,
    origin: `${protocol}//${host}`,
    protocol,
  };

  const fakeWindow = {
    location,
    sessionStorage: fakeSessionStorage,
  } as any;

  const fakeDocument: any = {
    createElement: () => ({}),
  };
  Object.defineProperty(fakeDocument, "cookie", {
    configurable: true,
    get: () => Array.from(cookieStore.entries()).map(([name, value]) => `${name}=${value}`).join("; "),
    set: (value: string) => {
      cookieWrites.push(value);
      const [pair] = value.split(";").map((part) => part.trim()).filter(Boolean);
      if (!pair) {
        return;
      }
      const [rawName, ...rawValueParts] = pair.split("=");
      const name = rawName.trim();
      const storedValue = rawValueParts.join("=");
      if (storedValue === "") {
        cookieStore.delete(name);
      } else {
        cookieStore.set(name, storedValue);
      }
    },
  });

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("sessionStorage", fakeSessionStorage);

  return {
    cookieStore,
    cookieWrites,
    location,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return true;
}

function findCookieAttributes(cookieWrites: string[], name: string): Map<string, string> | null {
  const raw = [...cookieWrites].reverse().find((entry) => entry.trim().toLowerCase().startsWith(`${name.toLowerCase()}=`));
  if (!raw) {
    return null;
  }
  const [, ...attributeParts] = raw.split(";").map((part) => part.trim()).filter(Boolean);
  const attrs = new Map<string, string>();
  for (const attribute of attributeParts) {
    const [attrName, ...attrValueParts] = attribute.split("=");
    attrs.set(attrName.toLowerCase(), attrValueParts.join("=") || "");
  }
  return attrs;
}

function getDefaultRefreshCookieName(projectId: string, secure: boolean): string {
  const prefix = secure ? "__Host-" : "";
  return `${prefix}stack-refresh-${projectId}--default`;
}

function getCustomRefreshCookieName(projectId: string, domain: string): string {
  const encoded = encodeBase32(new TextEncoder().encode(domain.toLowerCase()));
  return `stack-refresh-${projectId}--custom-${encoded}`;
}

it("should set refresh token cookies for trusted parent domains", async ({ expect }) => {
  const { cookieStore, cookieWrites } = setupBrowserCookieEnv({ protocol: "https:" });

  const { clientApp } = await createApp(
    {
      config: {
        domains: [
          { domain: "https://example.com", handlerPath: "/handler" },
          { domain: "https://*.example.com", handlerPath: "/handler" },
        ],
      },
    },
    {
      client: {
        tokenStore: "cookie",
        noAutomaticPrefetch: true,
      },
    },
  );

  const email = `${crypto.randomUUID()}@trusted-cookie.test`;
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
    noRedirect: true,
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
    noRedirect: true,
  });
  expect(signInResult.status).toBe("ok");

  const defaultCookieName = getDefaultRefreshCookieName(clientApp.projectId, true);
  const customCookieName = getCustomRefreshCookieName(clientApp.projectId, "example.com");

  const defaultReady = await waitUntil(() => cookieStore.has(defaultCookieName), 2_000);
  expect(defaultReady).toBe(true);

  const customReady = await waitUntil(() => cookieStore.has(customCookieName), 10_000);
  expect(customReady).toBe(true);

  expect(cookieStore.has(defaultCookieName)).toBe(true);
  expect(cookieStore.has(customCookieName)).toBe(true);

  const valuesEqual = await waitUntil(() => cookieStore.get(customCookieName) === cookieStore.get(defaultCookieName), 10_000);
  expect(valuesEqual).toBe(true);

  const defaultValue = cookieStore.get(defaultCookieName)!;
  const parsedValue = JSON.parse(decodeURIComponent(defaultValue));
  expect(typeof parsedValue.refresh_token).toBe("string");
  expect(parsedValue.refresh_token.length).toBeGreaterThan(10);
  expect(typeof parsedValue.updated_at).toBe("number");

  const defaultAttrs = findCookieAttributes(cookieWrites, defaultCookieName);
  expect(defaultAttrs).not.toBeNull();
  expect(defaultAttrs?.has("secure")).toBe(true);
  expect(defaultAttrs?.get("domain")).toBeUndefined();

  const customAttrs = findCookieAttributes(cookieWrites, customCookieName);
  expect(customAttrs?.get("domain")).toBe("example.com");

  const legacyProjectCookie = `stack-refresh-${clientApp.projectId}`;
  expect(cookieWrites.some((entry) => entry.toLowerCase().startsWith(`${legacyProjectCookie.toLowerCase()}=`) && entry.toLowerCase().includes("expires="))).toBe(true);
  expect(cookieWrites.some((entry) => entry.toLowerCase().startsWith("stack-refresh=") && entry.toLowerCase().includes("expires="))).toBe(true);
});

it("should avoid setting custom refresh cookies when no trusted parent domain is configured", async ({ expect }) => {
  const { cookieStore } = setupBrowserCookieEnv({ protocol: "https:" });

  const { clientApp } = await createApp(
    {
      config: {
        domains: [
          { domain: "https://example.com", handlerPath: "/handler" },
          { domain: "https://tenant.example.com", handlerPath: "/handler" },
        ],
      },
    },
    {
      client: {
        tokenStore: "cookie",
        noAutomaticPrefetch: true,
      },
    },
  );

  const email = `${crypto.randomUUID()}@no-parent-cookie.test`;
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
    noRedirect: true,
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
    noRedirect: true,
  });
  expect(signInResult.status).toBe("ok");

  const defaultCookieName = getDefaultRefreshCookieName(clientApp.projectId, true);
  const customCookieName = getCustomRefreshCookieName(clientApp.projectId, "example.com");

  const defaultReady = await waitUntil(() => cookieStore.has(defaultCookieName), 2_000);
  expect(defaultReady).toBe(true);

  const customReady = await waitUntil(() => cookieStore.has(customCookieName), 2_000);
  expect(customReady).toBe(false);
  expect(cookieStore.has(customCookieName)).toBe(false);
});

it("should omit secure-only defaults when running on http origins", async ({ expect }) => {
  const { cookieStore, cookieWrites, location } = setupBrowserCookieEnv({ protocol: "http:", host: "app.example.com" });

  const { clientApp } = await createApp(
    {
      config: {
        domains: [
          { domain: "https://example.com", handlerPath: "/handler" },
          { domain: "https://*.example.com", handlerPath: "/handler" },
        ],
      },
    },
    {
      client: {
        tokenStore: "cookie",
        noAutomaticPrefetch: true,
      },
    },
  );

  // Sanity-check that we are in an HTTP context.
  expect(location.protocol).toBe("http:");

  const email = `${crypto.randomUUID()}@http-cookie.test`;
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
    noRedirect: true,
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
    noRedirect: true,
  });
  expect(signInResult.status).toBe("ok");

  const insecureDefaultCookieName = getDefaultRefreshCookieName(clientApp.projectId, false);
  const secureDefaultCookieName = getDefaultRefreshCookieName(clientApp.projectId, true);

  const defaultReady = await waitUntil(() => cookieStore.has(insecureDefaultCookieName), 2_000);
  expect(defaultReady).toBe(true);

  expect(cookieStore.has(secureDefaultCookieName)).toBe(false);

  const insecureAttrs = findCookieAttributes(cookieWrites, insecureDefaultCookieName);
  expect(insecureAttrs).not.toBeNull();
  expect(insecureAttrs?.has("secure")).toBe(false);
  expect(insecureAttrs?.get("domain")).toBeUndefined();
});

it("should read the newest refresh token payload from cookie storage", async ({ expect }) => {
  const { clientApp } = await createApp();

  const defaultCookieName = getDefaultRefreshCookieName(clientApp.projectId, true);
  const customCookieName = getCustomRefreshCookieName(clientApp.projectId, "example.com");

  const staleCookieValue = JSON.stringify({
    refresh_token: "stale-token",
    updated_at: 1700000000000,
  });
  const freshCookieValue = JSON.stringify({
    refresh_token: "fresh-token",
    updated_at: 1800000000000,
  });

  const cookieMap: Record<string, string> = {
    [defaultCookieName]: staleCookieValue,
    [customCookieName]: freshCookieValue,
    "stack-access": JSON.stringify(["fresh-token", "fresh-access-token"]),
  };

  const tokens = (clientApp as any)._getTokensFromCookies(cookieMap);
  expect(tokens.refreshToken).toBe("fresh-token");
  expect(tokens.accessToken).toBe("fresh-access-token");
});
