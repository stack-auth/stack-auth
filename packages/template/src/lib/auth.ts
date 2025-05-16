import { KnownError, StackClientInterface } from "@stackframe/stack-shared";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { neverResolve } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { constructRedirectUrl } from "../utils/url";
import { consumeVerifierAndStateCookie, saveVerifierAndState } from "./cookie";

export async function signInWithOAuth(
  iface: StackClientInterface,
  options: {
    provider: string,
    redirectUrl: string,
    errorRedirectUrl: string,
    providerScope?: string,
  }
) {
  const { codeChallenge, state } = await saveVerifierAndState();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: constructRedirectUrl(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: constructRedirectUrl(options.errorRedirectUrl, "errorRedirectUrl"),
    codeChallenge,
    state,
    type: "authenticate",
    providerScope: options.providerScope,
  });
  window.location.assign(location);
  await neverResolve();
}

export async function addNewOAuthProviderOrScope(
  iface: StackClientInterface,
  options: {
    provider: string,
    redirectUrl: string,
    errorRedirectUrl: string,
    providerScope?: string,
  },
  session: InternalSession,
) {
  const { codeChallenge, state } = await saveVerifierAndState();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: constructRedirectUrl(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: constructRedirectUrl(options.errorRedirectUrl, "errorRedirectUrl"),
    afterCallbackRedirectUrl: constructRedirectUrl(window.location.href, "afterCallbackRedirectUrl"),
    codeChallenge,
    state,
    type: "link",
    session,
    providerScope: options.providerScope,
  });
  window.location.assign(location);
  await neverResolve();
}

/**
 * Checks if the current URL has the query parameters for an OAuth callback, and if so, removes them.
 *
 * Must be synchronous for the logic in callOAuthCallback to work without race conditions.
 */
function consumeOAuthCallbackQueryParams() {
  const requiredParams = ["code", "state"];
  const originalUrl = new URL(window.location.href);
  for (const param of requiredParams) {
    if (!originalUrl.searchParams.has(param)) {
      console.warn(new Error(`Missing required query parameter on OAuth callback: ${param}. Maybe you opened or reloaded the oauth-callback page from your history?`));
      return null;
    }
  }

  const expectedState = originalUrl.searchParams.get("state") ?? throwErr("This should never happen; isn't state required above?");
  const cookieResult = consumeVerifierAndStateCookie(expectedState);

  if (!cookieResult) {
    // If the state can't be found in the cookies, then the callback wasn't meant for us.
    // Maybe the website uses another OAuth library?
    console.warn(deindent`
      Stack found an outer OAuth callback state in the query parameters, but not in cookies.
      
      This could have multiple reasons:
        - The cookie expired, because the OAuth flow took too long.
        - The user's browser deleted the cookie, either manually or because of a very strict cookie policy.
        - The cookie was already consumed by this page, and the user already logged in.
        - You are using another OAuth client library with the same callback URL as Stack.
        - The user opened the OAuth callback page from their history.

      Either way, it is probably safe to ignore this warning unless you are debugging an OAuth issue.
    `);
    return null;
  }


  const newUrl = new URL(originalUrl);
  for (const param of requiredParams) {
    newUrl.searchParams.delete(param);
  }

  // let's get rid of the authorization code in the history as we
  // don't redirect to `redirectUrl` if there's a validation error
  // (as the redirectUrl might be malicious!).
  //
  // We use history.replaceState instead of location.assign(...) to
  // prevent an unnecessary reload
  window.history.replaceState({}, "", newUrl.toString());

  return {
    originalUrl,
    codeVerifier: cookieResult.codeVerifier,
    state: expectedState,
  };
}

export async function callOAuthCallback(
  iface: StackClientInterface,
  redirectUrl: string,
) {
  // note: this part of the function (until the return) needs
  // to be synchronous, to prevent race conditions when
  // callOAuthCallback is called multiple times in parallel
  const consumed = consumeOAuthCallbackQueryParams();
  if (!consumed) return Result.ok(undefined);

  // the rest can be asynchronous (we now know that we are the
  // intended recipient of the callback, and the only instance
  // of callOAuthCallback that's running)
  try {
    return Result.ok(await iface.callOAuthCallback({
      oauthParams: consumed.originalUrl.searchParams,
      redirectUri: constructRedirectUrl(redirectUrl, "redirectUri"),
      codeVerifier: consumed.codeVerifier,
      state: consumed.state,
    }));
  } catch (e) {
    if (KnownError.isKnownError(e)) {
      throw e;
    }
    throw new StackAssertionError("Error signing in during OAuth callback. Please try again.", { cause: e });
  }
}
