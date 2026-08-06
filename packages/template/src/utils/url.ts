import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";


export function constructRedirectUrl(redirectUrl: URL | string | undefined, callbackUrlName: string) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === 'undefined' || !window.location) {
    throw new HexclaveAssertionError(`${callbackUrlName} option is required in a non-browser environment.`, { redirectUrl });
  }

  // These parameters form one continuation. Keeping only after_auth_return_to can return to the
  // callback URL but cannot complete its cross-domain PKCE handoff after an email opens in a new
  // tab.
  const retainedQueryParams = [
    "after_auth_return_to",
    "hexclave_cross_domain_state",
    "hexclave_cross_domain_code_challenge",
    "hexclave_cross_domain_after_callback_redirect_url",
  ];
  const currentUrl = new URL(window.location.href);
  const url = redirectUrl ? new URL(redirectUrl, window.location.href) : new URL(window.location.href);
  for (const param of retainedQueryParams) {
    const value = currentUrl.searchParams.get(param);
    if (value != null) {
      url.searchParams.set(param, value);
    }
  }
  url.hash = "";
  return url.toString();
}
