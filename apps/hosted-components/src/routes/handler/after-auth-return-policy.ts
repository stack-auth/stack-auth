export const hostedAuthFlowQueryParam = "hexclave_auth_flow";

const alwaysRequiresAfterAuthReturn = new Set([
  "sign-in",
  "log-in",
  "sign-up",
  "register",
  "forgot-password",
  "password-reset",
  "mfa",
  "onboarding",
  "oauth-callback",
  "magic-link-callback",
  "sign-out",
]);

const accountLinkingErrorCodes = new Set([
  "OAUTH_CONNECTION_ALREADY_CONNECTED_TO_ANOTHER_USER",
  "USER_ALREADY_CONNECTED_TO_ANOTHER_OAUTH_CONNECTION",
]);

export function requiresAfterAuthReturn(options: {
  handlerPath: string,
  searchParams: URLSearchParams,
}): boolean {
  if (alwaysRequiresAfterAuthReturn.has(options.handlerPath)) {
    return true;
  }
  if (options.handlerPath === "email-verification") {
    return options.searchParams.get(hostedAuthFlowQueryParam) === "1";
  }
  if (options.handlerPath === "error") {
    const errorCode = options.searchParams.get("errorCode");
    return errorCode == null || !accountLinkingErrorCodes.has(errorCode);
  }
  return false;
}

/**
 * Marks verification links created during sign-up/onboarding so the handler can distinguish them
 * from standalone verification initiated in account settings.
 */
export function createAuthFlowEmailVerificationUrl(options: {
  emailVerificationUrl: string,
  currentUrl: URL,
  rawAfterAuthReturnTo: string,
}): string {
  const verificationUrl = new URL(options.emailVerificationUrl, options.currentUrl);
  verificationUrl.searchParams.set("after_auth_return_to", options.rawAfterAuthReturnTo);
  verificationUrl.searchParams.set(hostedAuthFlowQueryParam, "1");
  verificationUrl.hash = "";
  return verificationUrl.toString();
}
