
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";


export function constructRedirectUrl(redirectUrl: URL | string | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof window === 'undefined' || !window.location) {
    throw new StackAssertionError("Attempted to call constructRedirectUrl in a non-browser environment. You may be able to fix this by passing the `callbackUrl` option with your function call.", { redirectUrl });
  }

  const retainedQueryParams = ["after_auth_return_to"];
  const currentUrl = new URL(window.location.href);
  const url = redirectUrl ? new URL(redirectUrl, window.location.href) : new URL(window.location.href);
  for (const param of retainedQueryParams) {
    if (currentUrl.searchParams.has(param)) {
      url.searchParams.set(param, currentUrl.searchParams.get(param)!);
    }
  }
  url.hash = "";
  return url.toString();
}
