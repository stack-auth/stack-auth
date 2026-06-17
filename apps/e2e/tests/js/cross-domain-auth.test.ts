import { StackClientApp } from "@hexclave/js";
import { afterEach, vi } from "vitest";
import { it, localRedirectUrl } from "../helpers";

function createMockDocument(): Document {
  const cookieJar = new Map<string, string>();
  return {
    get cookie() {
      return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(str: string) {
      const parts = str.split(';');
      const [nameValue] = parts;
      const eqIndex = nameValue.indexOf('=');
      if (eqIndex >= 0) {
        const name = nameValue.slice(0, eqIndex).trim();
        const isExpired = parts.some(p => {
          const trimmed = p.trim().toLowerCase();
          if (!trimmed.startsWith('expires=')) return false;
          return new Date(trimmed.slice('expires='.length)) <= new Date();
        });
        if (isExpired) {
          cookieJar.delete(name);
        } else {
          cookieJar.set(name, nameValue.slice(eqIndex + 1).trim());
        }
      }
    },
    createElement: () => ({}),
  } as any;
}

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

    globalThis.document = createMockDocument();
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
    expect(redirectUrl.searchParams.get("hexclave_cross_domain_state")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("hexclave_cross_domain_code_challenge")).toEqual(expect.any(String));
    expect(redirectUrl.searchParams.get("hexclave_cross_domain_after_callback_redirect_url")).toBe(`${localRedirectUrl}/private-page?foo=bar`);
    const callbackUrl = new URL(redirectUrl.searchParams.get("after_auth_return_to") ?? "");
    expect(callbackUrl.origin).toBe(new URL(localRedirectUrl).origin);
    expect(callbackUrl.pathname).toBe(new URL(`${localRedirectUrl}/private-page`).pathname);
    expect(callbackUrl.searchParams.get("foo")).toBe("bar");
    expect(callbackUrl.searchParams.get("hexclave_cross_domain_auth")).toBe("1");
    expect(callbackUrl.searchParams.get("hexclave_cross_domain_state")).toEqual(expect.any(String));
    expect(callbackUrl.searchParams.get("hexclave_cross_domain_code_challenge")).toEqual(expect.any(String));
    expect(callbackUrl.searchParams.get("hexclave_cross_domain_after_callback_redirect_url")).toBe(`${localRedirectUrl}/private-page?foo=bar`);
  });
});

it("throws when app.urls.signIn is read for hosted flows", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "44444444-4444-4444-8444-444444444444";
    const currentHref = `${localRedirectUrl}/private-page?foo=bar`;

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        assign: () => { throw new Error("INTENTIONAL_TEST_ABORT"); },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;

    try {
      const clientApp = createClientApp(projectId);
      expect(() => clientApp.urls.signIn).toThrowError(/app\.urls\.signIn cannot be used when this app is configured to use hosted components.*Use app\.redirectToSignIn\(\) instead/s);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("throws when app.urls.signOut is read for hosted flows", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "55555555-5555-4555-8555-555555555555";
    const currentHref = `${localRedirectUrl}/signed-in-page?foo=bar`;

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        assign: () => { throw new Error("INTENTIONAL_TEST_ABORT"); },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;

    try {
      const clientApp = createClientApp(projectId);
      expect(() => clientApp.urls.signOut).toThrowError(/app\.urls\.signOut cannot be used when this app is configured to use hosted components.*Use app\.redirectToSignOut\(\) instead/s);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("strips stale OAuth callback params from hosted current-page redirect URIs", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const clientApp = createClientApp("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const currentUrl = new URL(`${localRedirectUrl}/callback-page?foo=bar`);
    currentUrl.searchParams.set("code", "oauth-code");
    currentUrl.searchParams.set("state", "oauth-state");
    currentUrl.searchParams.set("error", "access_denied");
    currentUrl.searchParams.set("error_description", "Denied");
    currentUrl.searchParams.set("errorCode", "KnownError");
    currentUrl.searchParams.set("message", "Known message");
    currentUrl.searchParams.set("details", "{}");

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
      },
    } as any;

    try {
      expect((clientApp as any)._getOAuthCallbackRedirectUri()).toBe(`${localRedirectUrl}/callback-page?foo=bar`);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("only treats hosted OAuth callback URLs as Stack callbacks when the matching state cookie exists", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const clientApp = createClientApp("ffffffff-ffff-4fff-8fff-ffffffffffff");
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: `${localRedirectUrl}/callback-page?code=oauth-code&state=oauth-state`,
      },
    } as any;

    try {
      expect((clientApp as any)._currentUrlLooksLikeHexclaveOAuthCallback()).toBe(false);
      globalThis.document.cookie = "stack-oauth-outer-oauth-state=verifier";
      expect((clientApp as any)._currentUrlLooksLikeHexclaveOAuthCallback()).toBe(true);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("keeps rejected pending auth resolutions from leaking into session consumers", async ({ expect }) => {
  const clientApp = createClientApp("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  vi.spyOn(clientApp as any, "_hasPersistentTokenStore").mockReturnValue(true);
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    (clientApp as any)._trackPendingAuthResolution(async () => {
      throw new Error("INTENTIONAL_TEST_AUTH_RESOLUTION_FAILURE");
    });

    await expect((clientApp as any)._awaitPendingAuthResolutions()).resolves.toBeUndefined();
  } finally {
    consoleErrorSpy.mockRestore();
  }
});

it("does not await pending auth resolutions when post-callback redirect mints a cross-domain code", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "12121212-1212-4212-8212-121212121212";
    const clientApp = createClientApp(projectId);
    const currentUrl = new URL(`${localRedirectUrl}/callback-page`);
    const redirectBackUrl = new URL(`${localRedirectUrl}/handler/oauth-callback`);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_auth", "1");
    redirectBackUrl.searchParams.set("hexclave_cross_domain_state", "state");
    redirectBackUrl.searchParams.set("hexclave_cross_domain_code_challenge", "challenge");
    redirectBackUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", `https://${projectId}.example-stack-hosted.test/after`);
    currentUrl.searchParams.set("after_auth_return_to", redirectBackUrl.toString());

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const createCrossDomainAuthRedirectUrlSpy = vi
      .spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl")
      .mockResolvedValue(`https://${projectId}.example-stack-hosted.test/handler/final`);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
        replace: () => {
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._redirectToHandler(
        "afterSignIn",
        { replace: true },
        {
          awaitPendingAuthResolutions: false,
          overrideTokenStoreInit: { accessToken: "fresh-access-token", refreshToken: "fresh-refresh-token" },
        },
      )).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).toHaveBeenCalledWith(expect.objectContaining({
      awaitPendingAuthResolutions: false,
      overrideTokenStoreInit: { accessToken: "fresh-access-token", refreshToken: "fresh-refresh-token" },
    }));
  });
});

it("does not await pending auth resolutions when post-callback redirect adds nested auth params", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "13131313-1313-4313-8313-131313131313";
    const clientApp = createClientApp(projectId);
    const fetchCurrentRefreshTokenIdIfSignedInSpy = vi
      .spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn")
      .mockResolvedValue(null);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: `${localRedirectUrl}/callback-page`,
        replace: () => {
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      // accountSettings (unlike afterSignIn & co, which resolve to local URLs) still lives on the
      // hosted domain, so it exercises the nested cross-domain auth params path.
      await expect((clientApp as any)._redirectToHandler(
        "accountSettings",
        { replace: true },
        { awaitPendingAuthResolutions: false },
      )).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(fetchCurrentRefreshTokenIdIfSignedInSpy).toHaveBeenCalledWith(expect.objectContaining({
      awaitPendingAuthResolutions: false,
    }));
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
    redirectBackUrl.searchParams.set("hexclave_cross_domain_auth", "1");
    redirectBackUrl.searchParams.set("hexclave_cross_domain_state", handoffState);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_code_challenge", handoffCodeChallenge);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", handoffAfterCallbackRedirect);

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

    globalThis.document = createMockDocument();
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
    relativeRedirectBackPath.searchParams.set("hexclave_cross_domain_auth", "1");
    relativeRedirectBackPath.searchParams.set("hexclave_cross_domain_state", handoffState);
    relativeRedirectBackPath.searchParams.set("hexclave_cross_domain_code_challenge", handoffCodeChallenge);
    relativeRedirectBackPath.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", handoffAfterCallbackRedirect);

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

    globalThis.document = createMockDocument();
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

it("adds nested cross-domain auth params when redirecting signed-in users to hosted account settings", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "66666666-6666-4666-8666-666666666666";
    const refreshTokenId = "source-refresh-token-id";
    const currentHref = `${localRedirectUrl}/dashboard?tab=settings`;
    const clientApp = createClientApp(projectId);

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(refreshTokenId);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";
    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        assign: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect(clientApp.redirectToAccountSettings()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
    expect(redirectUrl.pathname).toBe("/handler/account-settings");
    expect(redirectUrl.searchParams.get("stack_nested_cross_domain_auth_refresh_token_id")).toBe(refreshTokenId);
    expect(redirectUrl.searchParams.get("stack_nested_cross_domain_auth_callback_url")).toBe(currentHref);
  });
});

it("adds nested cross-domain auth params for other cross-domain handler redirects", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const refreshTokenId = "source-refresh-token-id";
    const currentHref = `${localRedirectUrl}/private-page`;
    const clientApp = createClientApp(projectId);

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(refreshTokenId);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";
    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        assign: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect(clientApp.redirectToTeamInvitation()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
    expect(redirectUrl.pathname).toBe("/handler/team-invitation");
    expect(redirectUrl.searchParams.get("stack_nested_cross_domain_auth_refresh_token_id")).toBe(refreshTokenId);
    expect(redirectUrl.searchParams.get("stack_nested_cross_domain_auth_callback_url")).toBe(currentHref);
  });
});

it("starts nested cross-domain auth from the target domain", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "77777777-7777-4777-8777-777777777777";
    const clientApp = createClientApp(projectId);
    const currentHref = `https://${projectId}.example-stack-hosted.test/handler/account-settings?stack_nested_cross_domain_auth_refresh_token_id=source-session&stack_nested_cross_domain_auth_callback_url=${encodeURIComponent(`https://${projectId}.example-stack-hosted.test/handler/oauth-callback`)}`;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
    vi.spyOn(clientApp as any, "_getCrossDomainHandoffParamsForRedirect").mockResolvedValue({
      state: "nested-state",
      codeChallenge: "nested-code-challenge",
    });
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(true);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.pathname).toBe("/handler/oauth-callback");
    expect(redirectUrl.searchParams.get("stack_nested_cross_domain_auth_refresh_token_id")).toBe("source-session");
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(currentHref);
    expect(redirectUrl.searchParams.get("state")).toBe("nested-state");
    expect(redirectUrl.searchParams.get("code_challenge")).toBe("nested-code-challenge");
    expect(redirectUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(redirectUrl.searchParams.get("after_callback_redirect_url")).toBe(`https://${projectId}.example-stack-hosted.test/handler/account-settings`);
  });
});

it("carries hosted sign-in return state on the nested OAuth redirect URI", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "14141414-1414-4414-8414-141414141414";
    const clientApp = createClientApp(projectId);
    const sourceRefreshTokenId = "source-session";
    const handoffState = "state-from-hosted-sign-in";
    const handoffCodeChallenge = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789-._~";
    const returnToAppUrl = `${localRedirectUrl}/handler/sign-in`;
    const redirectBackUrl = new URL(`${localRedirectUrl}/handler/sign-in`);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_auth", "1");
    redirectBackUrl.searchParams.set("hexclave_cross_domain_state", handoffState);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_code_challenge", handoffCodeChallenge);
    redirectBackUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", returnToAppUrl);
    const currentUrl = new URL(`https://${projectId}.example-stack-hosted.test/handler/sign-in`);
    currentUrl.searchParams.set("after_auth_return_to", redirectBackUrl.toString());
    currentUrl.searchParams.set("hexclave_cross_domain_state", handoffState);
    currentUrl.searchParams.set("hexclave_cross_domain_code_challenge", handoffCodeChallenge);
    currentUrl.searchParams.set("hexclave_cross_domain_after_callback_redirect_url", returnToAppUrl);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", sourceRefreshTokenId);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_callback_url", `${localRedirectUrl}/handler/sign-in`);
    const expectedAfterCallbackRedirectUrl = new URL(currentUrl);
    expectedAfterCallbackRedirectUrl.searchParams.delete("stack_nested_cross_domain_auth_refresh_token_id");
    expectedAfterCallbackRedirectUrl.searchParams.delete("stack_nested_cross_domain_auth_callback_url");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
    vi.spyOn(clientApp as any, "_getCrossDomainHandoffParamsForRedirect").mockResolvedValue({
      state: "nested-state",
      codeChallenge: "nested-code-challenge",
    });
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(true);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    const redirectUrl = new URL(redirectedUrl);
    expect(redirectUrl.pathname).toBe(new URL(`${localRedirectUrl}/handler/sign-in`).pathname);
    expect(redirectUrl.searchParams.get("after_callback_redirect_url")).toBe(expectedAfterCallbackRedirectUrl.toString());
    const redirectUri = new URL(redirectUrl.searchParams.get("redirect_uri") ?? "");
    expect(redirectUri.origin).toBe(`https://${projectId}.example-stack-hosted.test`);
    expect(redirectUri.pathname).toBe("/handler/sign-in");
    expect(redirectUrl.searchParams.get("state")).toBe("nested-state");
    expect(redirectUrl.searchParams.get("code_challenge")).toBe("nested-code-challenge");
    expect(redirectUri.searchParams.get("after_auth_return_to")).toBe(redirectBackUrl.toString());
    expect(redirectUri.searchParams.get("hexclave_cross_domain_state")).toBe(handoffState);
    expect(redirectUri.searchParams.get("hexclave_cross_domain_code_challenge")).toBe(handoffCodeChallenge);
    expect(redirectUri.searchParams.get("hexclave_cross_domain_after_callback_redirect_url")).toBe(returnToAppUrl);
  });
});

it("continues nested cross-domain auth on the source domain", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "88888888-8888-4888-8888-888888888888";
    const clientApp = createClientApp(projectId);
    const sourceRefreshTokenId = "source-session";
    const redirectUri = `https://${projectId}.example-stack-hosted.test/handler/account-settings?stack_nested_cross_domain_auth_refresh_token_id=source-session`;
    const currentUrl = new URL(`${localRedirectUrl}/nested-provider`);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", sourceRefreshTokenId);
    currentUrl.searchParams.set("redirect_uri", redirectUri);
    currentUrl.searchParams.set("state", "nested-state");
    currentUrl.searchParams.set("code_challenge", "nested-code-challenge");
    currentUrl.searchParams.set("code_challenge_method", "S256");
    currentUrl.searchParams.set("after_callback_redirect_url", `https://${projectId}.example-stack-hosted.test/handler/account-settings`);

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    let redirectedUrl = "";
    const crossDomainRedirect = `https://${projectId}.example-stack-hosted.test/handler/account-settings?code=nested-code&state=nested-state`;
    const createCrossDomainAuthRedirectUrlSpy = vi
      .spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl")
      .mockResolvedValue(crossDomainRedirect);
    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(sourceRefreshTokenId);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
        replace: (url: string) => {
          redirectedUrl = url;
          throw new Error("INTENTIONAL_TEST_ABORT");
        },
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError("INTENTIONAL_TEST_ABORT");
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).toHaveBeenCalledWith({
      redirectUri,
      state: "nested-state",
      codeChallenge: "nested-code-challenge",
      afterCallbackRedirectUrl: `https://${projectId}.example-stack-hosted.test/handler/account-settings`,
      awaitPendingAuthResolutions: false,
    });
    expect(redirectedUrl).toBe(crossDomainRedirect);
  });
});

it("rejects nested cross-domain auth when the source redirect URI is untrusted", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const clientApp = createClientApp(projectId);
    const currentUrl = new URL(`${localRedirectUrl}/nested-provider`);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "source-session");
    currentUrl.searchParams.set("redirect_uri", "https://evil.example.test/handler/account-settings");
    currentUrl.searchParams.set("state", "nested-state");
    currentUrl.searchParams.set("code_challenge", "nested-code-challenge");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const createCrossDomainAuthRedirectUrlSpy = vi.spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl");
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(false);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError(/not trusted/);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).not.toHaveBeenCalled();
  });
});

it("rejects nested cross-domain auth when the callback URL is untrusted", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "99999999-9999-4999-8999-999999999999";
    const clientApp = createClientApp(projectId);
    const currentHref = `https://${projectId}.example-stack-hosted.test/handler/account-settings?stack_nested_cross_domain_auth_refresh_token_id=source-session&stack_nested_cross_domain_auth_callback_url=${encodeURIComponent("https://evil.example.test/oauth-callback")}`;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue(null);
    vi.spyOn(clientApp as any, "_isTrusted").mockResolvedValue(false);

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentHref,
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError(/not trusted/);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});

it("rejects nested cross-domain auth when the source session does not match", async ({ expect }) => {
  await withHostedDomainSuffix(async () => {
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const clientApp = createClientApp(projectId);
    const currentUrl = new URL(`${localRedirectUrl}/nested-provider`);
    currentUrl.searchParams.set("stack_nested_cross_domain_auth_refresh_token_id", "requested-source-session");
    currentUrl.searchParams.set("redirect_uri", `https://${projectId}.example-stack-hosted.test/handler/account-settings`);
    currentUrl.searchParams.set("state", "nested-state");
    currentUrl.searchParams.set("code_challenge", "nested-code-challenge");

    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const createCrossDomainAuthRedirectUrlSpy = vi.spyOn(clientApp as any, "_createCrossDomainAuthRedirectUrl");
    vi.spyOn(clientApp as any, "_fetchCurrentRefreshTokenIdIfSignedIn").mockResolvedValue("different-source-session");

    globalThis.document = createMockDocument();
    globalThis.window = {
      location: {
        href: currentUrl.toString(),
      },
    } as any;

    try {
      await expect((clientApp as any)._maybeHandleNestedCrossDomainAuth()).rejects.toThrowError(/does not match/);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }

    expect(createCrossDomainAuthRedirectUrlSpy).not.toHaveBeenCalled();
  });
});
