import { isAcceptedNativeAppUrl, validateRedirectUrl as validateRedirectUrlAgainstTrustedDomains } from "@stackframe/stack-shared/dist/utils/redirect-urls";
import { Tenancy } from "./tenancies";

export { isAcceptedNativeAppUrl };

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: Tenancy,
): boolean {
  return validateRedirectUrlAgainstTrustedDomains(urlOrString, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: Object.values(tenancy.config.domains.trustedDomains).map(domain => domain.baseUrl),
  });
}
