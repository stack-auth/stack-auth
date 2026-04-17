import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import { HandlerUrls } from "../../common";

export const crossDomainAuthQueryParams = {
  marker: "stack_cross_domain_auth",
  state: "stack_cross_domain_state",
  codeChallenge: "stack_cross_domain_code_challenge",
  afterCallbackRedirectUrl: "stack_cross_domain_after_callback_redirect_url",
} as const;

export type CrossDomainHandoffParams = {
  state: string,
  codeChallenge: string,
};

export function getCrossDomainHandoffParamsFromCurrentUrl(currentUrl: URL): CrossDomainHandoffParams | null {
  const state = currentUrl.searchParams.get(crossDomainAuthQueryParams.state);
  const codeChallenge = currentUrl.searchParams.get(crossDomainAuthQueryParams.codeChallenge);
  if (state == null || codeChallenge == null) {
    return null;
  }
  return { state, codeChallenge };
}

type RedirectBackAwareHandlerName = "signIn" | "signUp" | "onboarding" | "signOut";
type HandlerRedirectPolicy = "none" | "redirect-back-aware" | "after-auth-return";

type CrossDomainHandoffParamsMaybeMissing = {
  state: string | null,
  codeChallenge: string | null,
  afterCallbackRedirectUrl: string | null,
};

function isRedirectBackAwareHandlerName(handlerName: keyof HandlerUrls): handlerName is RedirectBackAwareHandlerName {
  return handlerName === "signIn"
    || handlerName === "signUp"
    || handlerName === "onboarding"
    || handlerName === "signOut";
}

function hasCrossDomainHandoffParams(url: URL): boolean {
  return (
    url.searchParams.has(crossDomainAuthQueryParams.state)
    && url.searchParams.has(crossDomainAuthQueryParams.codeChallenge)
    && url.searchParams.has(crossDomainAuthQueryParams.afterCallbackRedirectUrl)
  );
}

function buildCrossDomainAuthCallbackUrl(options: {
  currentUrl: URL,
  localOAuthCallbackUrl: string,
  state?: string,
  codeChallenge?: string,
  afterCallbackRedirectUrl?: string,
}): URL {
  const localOAuthCallbackUrl = new URL(options.localOAuthCallbackUrl, options.currentUrl);
  if (localOAuthCallbackUrl.origin !== options.currentUrl.origin) {
    throw new StackAssertionError("Cross-domain auth callback URL must stay on the current origin", {
      localOAuthCallbackUrl: localOAuthCallbackUrl.toString(),
      currentUrl: options.currentUrl.toString(),
    });
  }
  localOAuthCallbackUrl.searchParams.set(crossDomainAuthQueryParams.marker, "1");
  if (options.state != null) {
    localOAuthCallbackUrl.searchParams.set(crossDomainAuthQueryParams.state, options.state);
  }
  if (options.codeChallenge != null) {
    localOAuthCallbackUrl.searchParams.set(crossDomainAuthQueryParams.codeChallenge, options.codeChallenge);
  }
  if (options.afterCallbackRedirectUrl != null) {
    localOAuthCallbackUrl.searchParams.set(crossDomainAuthQueryParams.afterCallbackRedirectUrl, options.afterCallbackRedirectUrl);
  }
  return localOAuthCallbackUrl;
}

function buildRedirectBackAwareHandlerUrl(options: {
  handlerName: RedirectBackAwareHandlerName,
  rawHandlerUrl: string,
  currentUrl: URL,
  crossDomainHandoffParams: CrossDomainHandoffParams | null,
  localOAuthCallbackUrl: string,
}): string {
  const nextUrl = new URL(options.rawHandlerUrl, options.currentUrl);
  for (const preservedParam of [
    "after_auth_return_to",
    crossDomainAuthQueryParams.state,
    crossDomainAuthQueryParams.codeChallenge,
    crossDomainAuthQueryParams.afterCallbackRedirectUrl,
  ]) {
    const currentValue = options.currentUrl.searchParams.get(preservedParam);
    if (currentValue != null && !nextUrl.searchParams.has(preservedParam)) {
      nextUrl.searchParams.set(preservedParam, currentValue);
    }
  }

  if (options.handlerName === "signOut") {
    if (!nextUrl.searchParams.has("after_auth_return_to")) {
      if (options.currentUrl.protocol === nextUrl.protocol && options.currentUrl.host === nextUrl.host) {
        nextUrl.searchParams.set("after_auth_return_to", getRelativePart(options.currentUrl));
      } else {
        nextUrl.searchParams.set("after_auth_return_to", options.currentUrl.toString());
      }
    }
    return nextUrl.origin === options.currentUrl.origin ? getRelativePart(nextUrl) : nextUrl.toString();
  }

  const isCrossDomainHandlerRedirect = options.currentUrl.origin !== nextUrl.origin;
  if (isCrossDomainHandlerRedirect) {
    if (!hasCrossDomainHandoffParams(nextUrl)) {
      const inheritedAfterAuthReturnTo = options.currentUrl.searchParams.get("after_auth_return_to");
      const afterCallbackRedirectUrl = inheritedAfterAuthReturnTo
        ? new URL(inheritedAfterAuthReturnTo, options.currentUrl).toString()
        : options.currentUrl.toString();
      const callbackUrl = buildCrossDomainAuthCallbackUrl({
        currentUrl: options.currentUrl,
        localOAuthCallbackUrl: options.localOAuthCallbackUrl,
        state: options.crossDomainHandoffParams?.state,
        codeChallenge: options.crossDomainHandoffParams?.codeChallenge,
        afterCallbackRedirectUrl,
      });

      nextUrl.searchParams.set("after_auth_return_to", callbackUrl.toString());
      nextUrl.searchParams.set(crossDomainAuthQueryParams.afterCallbackRedirectUrl, afterCallbackRedirectUrl);
      if (options.crossDomainHandoffParams != null) {
        nextUrl.searchParams.set(crossDomainAuthQueryParams.state, options.crossDomainHandoffParams.state);
        nextUrl.searchParams.set(crossDomainAuthQueryParams.codeChallenge, options.crossDomainHandoffParams.codeChallenge);
      }
    }
  } else if (options.currentUrl.protocol === nextUrl.protocol && options.currentUrl.host === nextUrl.host && !nextUrl.searchParams.has("after_auth_return_to")) {
    nextUrl.searchParams.set("after_auth_return_to", getRelativePart(options.currentUrl));
  }

  return nextUrl.origin === options.currentUrl.origin ? getRelativePart(nextUrl) : nextUrl.toString();
}

function getHandlerRedirectPolicy(handlerName: keyof HandlerUrls): HandlerRedirectPolicy {
  if (handlerName === "afterSignIn" || handlerName === "afterSignUp") {
    return "after-auth-return";
  }
  if (isRedirectBackAwareHandlerName(handlerName)) {
    return "redirect-back-aware";
  }
  return "none";
}

type RedirectToHandlerPlan =
  | { type: "redirect", url: string }
  | {
    type: "cross-domain-authorize",
    redirectUri: string,
    state: string,
    codeChallenge: string,
    afterCallbackRedirectUrl: string,
  };


async function resolveRedirectBackAwareHandlerUrlForRedirect(options: {
  handlerName: RedirectBackAwareHandlerName,
  rawHandlerUrl: string,
  currentUrl: URL,
  localOAuthCallbackUrl: string,
  getCrossDomainHandoffParams: (currentUrl: URL) => Promise<CrossDomainHandoffParams>,
}): Promise<string> {
  const initial = buildRedirectBackAwareHandlerUrl({
    handlerName: options.handlerName,
    rawHandlerUrl: options.rawHandlerUrl,
    currentUrl: options.currentUrl,
    crossDomainHandoffParams: null,
    localOAuthCallbackUrl: options.localOAuthCallbackUrl,
  });
  if (options.handlerName === "signOut") {
    return initial;
  }

  const initialTarget = new URL(initial, options.currentUrl);
  const isCrossDomainHandlerRedirect = options.currentUrl.origin !== initialTarget.origin;
  if (!isCrossDomainHandlerRedirect || hasCrossDomainHandoffParams(initialTarget)) {
    return initial;
  }

  const crossDomainHandoffParams = await options.getCrossDomainHandoffParams(options.currentUrl);
  return buildRedirectBackAwareHandlerUrl({
    handlerName: options.handlerName,
    rawHandlerUrl: options.rawHandlerUrl,
    currentUrl: options.currentUrl,
    crossDomainHandoffParams,
    localOAuthCallbackUrl: options.localOAuthCallbackUrl,
  });
}

export async function planRedirectToHandler(options: {
  handlerName: keyof HandlerUrls,
  rawHandlerUrl: string,
  noRedirectBack: boolean,
  currentUrl: URL | null,
  localOAuthCallbackUrl: string,
  getCrossDomainHandoffParams: (currentUrl: URL) => Promise<CrossDomainHandoffParams>,
}): Promise<RedirectToHandlerPlan> {
  if (options.noRedirectBack || options.currentUrl == null) {
    return { type: "redirect", url: options.rawHandlerUrl };
  }

  const policy = getHandlerRedirectPolicy(options.handlerName);
  if (policy === "none") {
    return { type: "redirect", url: options.rawHandlerUrl };
  }

  if (policy === "after-auth-return") {
    const redirectBackUrl = options.currentUrl.searchParams.get("after_auth_return_to");
    if (redirectBackUrl == null) {
      return { type: "redirect", url: options.rawHandlerUrl };
    }
    const redirectBackTarget = new URL(redirectBackUrl, options.currentUrl);
    const crossDomainHandoff = getCrossDomainHandoffForRedirect({
      currentUrl: options.currentUrl,
      redirectBackTarget,
    });
    if (crossDomainHandoff == null) {
      return { type: "redirect", url: redirectBackUrl };
    }
    let state = crossDomainHandoff.handoffParams.state;
    let codeChallenge = crossDomainHandoff.handoffParams.codeChallenge;
    let afterCallbackRedirectUrl = crossDomainHandoff.handoffParams.afterCallbackRedirectUrl;
    if (state == null || codeChallenge == null) {
      const generatedHandoffParams = await options.getCrossDomainHandoffParams(options.currentUrl);
      state ??= generatedHandoffParams.state;
      codeChallenge ??= generatedHandoffParams.codeChallenge;
    }
    afterCallbackRedirectUrl ??= options.currentUrl.toString();
    return {
      type: "cross-domain-authorize",
      redirectUri: crossDomainHandoff.redirectBackTarget.toString(),
      state,
      codeChallenge,
      afterCallbackRedirectUrl,
    };
  }

  if (
    options.handlerName !== "signIn"
    && options.handlerName !== "signUp"
    && options.handlerName !== "onboarding"
    && options.handlerName !== "signOut"
  ) {
    throw new StackAssertionError("Unexpected redirect-back-aware handler policy mismatch", {
      handlerName: options.handlerName,
      policy,
    });
  }

  return {
    type: "redirect",
    url: await resolveRedirectBackAwareHandlerUrlForRedirect({
      handlerName: options.handlerName,
      rawHandlerUrl: options.rawHandlerUrl,
      currentUrl: options.currentUrl,
      localOAuthCallbackUrl: options.localOAuthCallbackUrl,
      getCrossDomainHandoffParams: options.getCrossDomainHandoffParams,
    }),
  };
}

function readCrossDomainHandoffParams(currentUrl: URL, redirectBackTarget: URL): CrossDomainHandoffParamsMaybeMissing {
  const state = currentUrl.searchParams.get(crossDomainAuthQueryParams.state)
    ?? redirectBackTarget.searchParams.get(crossDomainAuthQueryParams.state);
  const codeChallenge = currentUrl.searchParams.get(crossDomainAuthQueryParams.codeChallenge)
    ?? redirectBackTarget.searchParams.get(crossDomainAuthQueryParams.codeChallenge);
  const afterCallbackRedirectUrl = currentUrl.searchParams.get(crossDomainAuthQueryParams.afterCallbackRedirectUrl)
    ?? redirectBackTarget.searchParams.get(crossDomainAuthQueryParams.afterCallbackRedirectUrl);
  return {
    state,
    codeChallenge,
    afterCallbackRedirectUrl,
  };
}

function resolveCrossDomainRedirectBackTarget(options: {
  currentUrl: URL,
  redirectBackTarget: URL,
  handoffParams: CrossDomainHandoffParamsMaybeMissing,
}): URL | null {
  if (options.redirectBackTarget.origin !== options.currentUrl.origin) {
    return options.redirectBackTarget;
  }
  if (
    options.handoffParams.state == null
    || options.handoffParams.codeChallenge == null
    || options.handoffParams.afterCallbackRedirectUrl == null
  ) {
    return null;
  }
  const afterCallbackRedirectTarget = new URL(options.handoffParams.afterCallbackRedirectUrl, options.currentUrl);
  if (afterCallbackRedirectTarget.origin === options.currentUrl.origin) {
    return null;
  }
  return new URL(
    `${options.redirectBackTarget.pathname}${options.redirectBackTarget.search}${options.redirectBackTarget.hash}`,
    afterCallbackRedirectTarget.origin,
  );
}

function getCrossDomainHandoffForRedirect(options: {
  currentUrl: URL,
  redirectBackTarget: URL,
}): {
  redirectBackTarget: URL,
  handoffParams: CrossDomainHandoffParamsMaybeMissing,
} | null {
  const handoffParams = readCrossDomainHandoffParams(options.currentUrl, options.redirectBackTarget);
  const crossDomainRedirectBackTarget = resolveCrossDomainRedirectBackTarget({
    currentUrl: options.currentUrl,
    redirectBackTarget: options.redirectBackTarget,
    handoffParams,
  });
  if (crossDomainRedirectBackTarget == null) {
    return null;
  }
  return {
    redirectBackTarget: crossDomainRedirectBackTarget,
    handoffParams,
  };
}
