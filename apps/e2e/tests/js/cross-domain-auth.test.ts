import { StackClientApp } from "@stackframe/js";
import { afterEach, vi } from "vitest";
import { it, localRedirectUrl } from "../helpers";

const withHostedDomainSuffix = async (callback: () => Promise<void>) => {
  const oldHostedHandlerDomainSuffix = process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX;
  const oldHostedHandlerUrlTemplate = process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE;
  process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX = ".example-stack-hosted.test";
  delete process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE;

  try {
    await callback();
  } finally {
    if (oldHostedHandlerDomainSuffix == null) {
      delete process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX;
    } else {
      process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX = oldHostedHandlerDomainSuffix;
    }
    if (oldHostedHandlerUrlTemplate == null) {
      delete process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE;
    } else {
      process.env.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE = oldHostedHandlerUrlTemplate;
    }
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

const createClientApp = (projectId: string) => new StackClientApp({
  baseUrl: "http://localhost:8102",
  projectId,
  publishableClientKey: "test-publishable-client-key",
  tokenStore: "memory",
  redirectMethod: "window",
  urls: {
    default: { type: "hosted" },
  },
});

it("adds secure cross-domain handoff parameters when redirecting to hosted sign-in", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const clientApp = createClientApp(projectId);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    globalThis.document = { cookie: "", createElement: () => ({}) } as any;
    globalThis.window = {
      location: {
        href: `${localRedirectUrl}/private-page?foo=bar`,
        assign: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect(clientApp.redirectToSignIn()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
    expect(redirectUrl.pathname).toBe("/handler/sign-in");
    expect(redirectUrl.searchParams.get("stack_cross_domain_state")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("stack_cross_domain_code_challenge")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("stack_cross_domain_after_callback_redirect_url")).toBe(`${localRedirectUrl}/private-page?foo=bar`);
    const callbackUrl = new URL(redirectUrl.searchParams.get("after_auth_return_to") ?? "");
    expect(callbackUrl.origin).toBe(new URL(localRedirectUrl).origin);
    expect(callbackUrl.pathname).toBe("/handler/oauth-callback");
    expect(callbackUrl.searchParams.get("stack_cross_domain_auth")).toBe("1");
    expect(callbackUrl.searchParams.get("stack_cross_domain_state")).toEqual(expect.any(String));
    expect(callbackUrl.searchParams.get("stack_cross_domain_code_challenge")).toEqual(expect.any(String));
    expect(callbackUrl.searchParams.get("stack_cross_domain_after_callback_redirect_url")).toBe(`${localRedirectUrl}/private-page?foo=bar`);
  });
});

it("returns static app.urls.signIn for hosted flows", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    const currentHref = `${localRedirectUrl}/private-page?foo=bar`;

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = { cookie: "", createElement: () => ({}) } as any;
    globalThis.window = {
      location: {
        href: currentHref,
        assign: () => { throw new Error("INTENTIONAL_TEST_ABORT"); },
      },
    } as any;

    try {
      const clientApp = createClientApp(projectId);
      const signInUrl = new URL(clientApp.urls.signIn);
      expect(signInUrl.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
      expect(signInUrl.pathname).toBe("/handler/sign-in");
      expect(signInUrl.searchParams.get("after_auth_return_to")).toBeNull();
      expect(signInUrl.searchParams.get("stack_cross_domain_state")).toBeNull();
      expect(signInUrl.searchParams.get("stack_cross_domain_code_challenge")).toBeNull();
      expect(signInUrl.searchParams.get("stack_cross_domain_after_callback_redirect_url")).toBeNull();
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("returns static app.urls.signOut for hosted flows", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "55555555-5555-4555-8555-555555555555";
    const currentHref = `${localRedirectUrl}/signed-in-page?foo=bar`;

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = { cookie: "", createElement: () => ({}) } as any;
    globalThis.window = {
      location: {
        href: currentHref,
        assign: () => { throw new Error("INTENTIONAL_TEST_ABORT"); },
      },
    } as any;

    try {
      const clientApp = createClientApp(projectId);
      const signOutUrl = new URL(clientApp.urls.signOut);
      expect(signOutUrl.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
      expect(signOutUrl.pathname).toBe("/handler/sign-out");
      expect(signOutUrl.searchParams.get("after_auth_return_to")).toBeNull();
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("keeps cross-domain handoff working when top-level params are dropped before after-sign-in", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const clientApp = createClientApp(projectId);

    const handoffState = "state-from-initial-sign-in";
    const handoffCodeChallenge = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789-._~";
    const handoffAfterCallbackRedirect = `${localRedirectUrl}/cross-domain-handoff`;
    const redirectBackUrl = new URL(`${localRedirectUrl}/handler/oauth-callback`);
    redirectBackUrl.searchParams.set("stack_cross_domain_auth", "1");
    redirectBackUrl.searchParams.set("stack_cross_domain_state", handoffState);
    redirectBackUrl.searchParams.set("stack_cross_domain_code_challenge", handoffCodeChallenge);
    redirectBackUrl.searchParams.set("stack_cross_domain_after_callback_redirect_url", handoffAfterCallbackRedirect);

    const hostedAfterSignInCallbackUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/oauth-callback`);
    hostedAfterSignInCallbackUrl.searchParams.set("after_auth_return_to", redirectBackUrl.toString());
    hostedAfterSignInCallbackUrl.searchParams.set("code", "inner-hosted-code");
    hostedAfterSignInCallbackUrl.searchParams.set("state", "inner-hosted-state");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    const crossDomainAuthorizeRedirect = `https://${projectId}.example-stack-hosted.test/handler/final-cross-domain-redirect`;
    const createCrossDomainAuthRedirectUrlSpy = vi
      .spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl")
      .mockResolvedValue(crossDomainAuthorizeRedirect);

    globalThis.document = { cookie: "", createElement: () => ({}) } as any;
    globalThis.window = {
      location: {
        href: hostedAfterSignInCallbackUrl.toString(),
        assign: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect(clientApp.redirectToAfterSignIn()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).toHaveBeenCalledWith({
      redirectUri: redirectBackUrl.toString(),
      state: handoffState,
      codeChallenge: handoffCodeChallenge,
      afterCallbackRedirectUrl: handoffAfterCallbackRedirect,
    });
    expect(redirectedUrl).toBe(crossDomainAuthorizeRedirect);
  });
});

it("keeps cross-domain handoff working when after_auth_return_to is rewritten to same-origin relative URL", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "33333333-3333-4333-8333-333333333333";
    const clientApp = createClientApp(projectId);

    const handoffState = "state-from-relative-after-auth-return";
    const handoffCodeChallenge = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const handoffAfterCallbackRedirect = "http://p93.localhost:9303/cross-domain-handoff";
    const relativeRedirectBackPath = new URL("/handler/oauth-callback", `https://${projectId}.example-stack-hosted.test`);
    relativeRedirectBackPath.searchParams.set("stack_cross_domain_auth", "1");
    relativeRedirectBackPath.searchParams.set("stack_cross_domain_state", handoffState);
    relativeRedirectBackPath.searchParams.set("stack_cross_domain_code_challenge", handoffCodeChallenge);
    relativeRedirectBackPath.searchParams.set("stack_cross_domain_after_callback_redirect_url", handoffAfterCallbackRedirect);

    const hostedAfterSignInCallbackUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/oauth-callback`);
    hostedAfterSignInCallbackUrl.searchParams.set("after_auth_return_to", `${relativeRedirectBackPath.pathname}${relativeRedirectBackPath.search}`);
    hostedAfterSignInCallbackUrl.searchParams.set("code", "inner-hosted-code");
    hostedAfterSignInCallbackUrl.searchParams.set("state", "inner-hosted-state");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    const crossDomainAuthorizeRedirect = `https://${projectId}.example-stack-hosted.test/handler/final-cross-domain-redirect`;
    const createCrossDomainAuthRedirectUrlSpy = vi
      .spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl")
      .mockResolvedValue(crossDomainAuthorizeRedirect);

    globalThis.document = { cookie: "", createElement: () => ({}) } as any;
    globalThis.window = {
      location: {
        href: hostedAfterSignInCallbackUrl.toString(),
        assign: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect(clientApp.redirectToAfterSignIn()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).toHaveBeenCalledTimes(1);
    expect(createCrossDomainAuthRedirectUrlSpy).toHaveBeenCalledWith(expect.objectContaining({
      redirectUri: expect.stringContaining("http://p93.localhost:9303/handler/oauth-callback?"),
      state: handoffState,
      codeChallenge: handoffCodeChallenge,
      afterCallbackRedirectUrl: handoffAfterCallbackRedirect,
    }));
    expect(redirectedUrl).toBe(crossDomainAuthorizeRedirect);
  });
});
