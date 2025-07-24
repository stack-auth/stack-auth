import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createUrlIfValid, isLocalhost } from "@stackframe/stack-shared/dist/utils/urls";

export function validateRedirectUrl(urlOrString: string | URL, domains: { baseUrl: string }[], allowLocalhost: boolean): boolean {
  const url = createUrlIfValid(urlOrString);
  if (!url) return false;
  if (allowLocalhost && isLocalhost(url)) {
    return true;
  }
  return domains.some((domain) => {
    const testUrl = url;
    const baseUrl = createUrlIfValid(domain.baseUrl);
    if (!baseUrl) {
      captureError("invalid-redirect-domain", new StackAssertionError("Invalid redirect domain; maybe this should be fixed in the database", {
        domain: domain.baseUrl,
      }));
      return false;
    }

    const sameOrigin = baseUrl.protocol === testUrl.protocol && baseUrl.hostname === testUrl.hostname;
    const isSubPath = testUrl.pathname.startsWith(baseUrl.pathname);

    return sameOrigin && isSubPath;
  });
}
