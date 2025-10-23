import { encodeBase32 } from "@stackframe/stack-shared/dist/utils/bytes";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { TextEncoder } from "util";
import { vi } from "vitest";
import { it } from "../helpers";
import { createApp, scaffoldProject } from "./js-helpers";


it("should scaffold the project", async ({ expect }) => {
  const { project } = await scaffoldProject();
  expect(project.displayName).toBe("New Project");
});

it("should sign up with credential", async ({ expect }) => {
  const { clientApp } = await createApp();
  const result1 = await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  expect(result1).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);

  const result2 = await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result2).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should create user on the server", async ({ expect }) => {
  const { serverApp } = await createApp();
  const user = await serverApp.createUser({
    primaryEmail: "test@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
  });

  expect(isUuid(user.id)).toBe(true);

  const user2 = await serverApp.getUser(user.id);
  expect(user2?.id).toBe(user.id);

  const result = await serverApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should throw a helpful error when destructuring user", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  const email = "user-destructure@test.com";
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
  });
  expect(signInResult.status).toBe("ok");

  const currentUser = await clientApp.getUser({ or: "throw" });
  const accessClientUser = () => (currentUser as any).user;
  expect(accessClientUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");

  const serverUser = await serverApp.getUser(currentUser.id);
  if (!serverUser) {
    throw new Error("Expected server user to exist for destructure guard test");
  }
  const accessServerUser = () => (serverUser as any).user;
  expect(accessServerUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");
});

it("should set refresh token cookies for trusted parent domains", async ({ expect }) => {
  const cookieWrites: string[] = [];
  const cookieStore = new Map<string, string>();

  const fakeSessionStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
    clear: () => { },
  };

  const fakeLocation = {
    host: "app.example.com",
    hostname: "app.example.com",
    href: "https://app.example.com/",
    origin: "https://app.example.com",
    protocol: "https:",
  };

  const fakeWindow = {
    location: fakeLocation,
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

  const { clientApp } = await createApp(
    {
      config: {
        domains: [
          { domain: "https://example.com", handlerPath: "/handler" },
          { domain: "https://*.example.com", handlerPath: "/handler" },
        ],
      }
    },
    {
      client: {
        tokenStore: "cookie",
        noAutomaticPrefetch: true,
      },
    }
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

  const defaultCookieName = `__Host-stack-refresh-${clientApp.projectId}--default`;
  const customCookieName = `stack-refresh-${clientApp.projectId}--custom-${encodeBase32(new TextEncoder().encode("example.com"))}`;

  const waitUntil = async (predicate: () => boolean, timeoutMs: number) => {
    const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt > timeoutMs) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return true;
  };

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

  const parseCookieAttributes = (name: string) => {
    const raw = [...cookieWrites].reverse().find((entry) => entry.trim().toLowerCase().startsWith(`${name.toLowerCase()}=`));
    if (!raw) {
      return null;
    }
    const [, ...attributeParts] = raw.split(";").map((part) => part.trim()).filter(Boolean);
    const attrs: Record<string, string> = {};
    for (const attribute of attributeParts) {
      const [attrName, ...attrValueParts] = attribute.split("=");
      attrs[attrName.toLowerCase()] = attrValueParts.join("=") || "";
    }
    return attrs;
  };

  const defaultAttrs = parseCookieAttributes(defaultCookieName);
  expect(defaultAttrs?.domain).toBeUndefined();
  expect(defaultAttrs).not.toBeNull();
  expect(Object.prototype.hasOwnProperty.call(defaultAttrs!, "secure")).toBe(true);

  const customAttrs = parseCookieAttributes(customCookieName);
  expect(customAttrs?.domain).toBe("example.com");

  const legacyProjectCookie = `stack-refresh-${clientApp.projectId}`;
  expect(cookieWrites.some((entry) => entry.toLowerCase().startsWith(`${legacyProjectCookie.toLowerCase()}=`) && entry.toLowerCase().includes("expires="))).toBe(true);
  expect(cookieWrites.some((entry) => entry.toLowerCase().startsWith("stack-refresh=") && entry.toLowerCase().includes("expires="))).toBe(true);
});
