import { isAcceptedNativeAppUrl, validateRedirectUrl as validateRedirectUrlAgainstTrustedDomains } from "@stackframe/stack-shared/dist/utils/redirect-urls";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { Tenancy } from "./tenancies";

export { isAcceptedNativeAppUrl };

const defaultHostedHandlerDomainSuffix = ".built-with-stack-auth.com";

/**
 * Returns the domain suffix for the hosted handler (e.g. ".built-with-stack-auth.com" in
 * production, ".localhost:8109" in local dev).
 */
export function getHostedHandlerDomainSuffix(): string {
  return getEnvVariable("NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX", defaultHostedHandlerDomainSuffix);
}

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: Tenancy,
): boolean {
  const hostedDomain = `${tenancy.project.id}${getHostedHandlerDomainSuffix()}`;
  return validateRedirectUrlAgainstTrustedDomains(urlOrString, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: [
      ...Object.values(tenancy.config.domains.trustedDomains).map(domain => domain.baseUrl),
      `http://${hostedDomain}`,
      `https://${hostedDomain}`,
    ],
  });
}
