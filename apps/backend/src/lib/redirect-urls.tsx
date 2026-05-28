import { getEnvVariable, getProcessEnv } from "@stackframe/stack-shared/dist/utils/env";
import { getHostedHandlerTrustedDomain as getHostedHandlerTrustedDomainFromConfig, isAcceptedNativeAppUrl, validateRedirectUrl as validateRedirectUrlAgainstTrustedDomains } from "@stackframe/stack-shared/dist/utils/redirect-urls";
import { Tenancy } from "./tenancies";

export { isAcceptedNativeAppUrl };

export function getHostedHandlerTrustedDomain(projectId: string): string {
  return getHostedHandlerTrustedDomainFromConfig({
    projectId,
    hostedHandlerDomainSuffix: getProcessEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX"),
    hostedHandlerUrlTemplate: getProcessEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE"),
    stackPortPrefix: getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81"),
  });
}

export function getTrustedDomainsForTenancy(tenancy: Tenancy): string[] {
  return [
    ...Object.values(tenancy.config.domains.trustedDomains)
      .map(domain => domain.baseUrl)
      .filter((baseUrl): baseUrl is string => baseUrl != null),
    getHostedHandlerTrustedDomain(tenancy.project.id),
  ];
}

export function getOAuthRedirectUrisForTenancy(tenancy: Tenancy): string[] {
  return [
    ...Object.values(tenancy.config.domains.trustedDomains)
      .filter((domain) => domain.baseUrl)
      .map((domain) => new URL(domain.handlerPath, domain.baseUrl).toString()),
    new URL("/handler/oauth-callback", getHostedHandlerTrustedDomain(tenancy.project.id)).toString(),
  ];
}

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: Tenancy,
): boolean {
  return validateRedirectUrlAgainstTrustedDomains(urlOrString, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  });
}

export function validateRedirectHostname(hostname: string, tenancy: Tenancy): boolean {
  return validateRedirectUrlAgainstTrustedDomains(`https://${hostname}`, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  }) || validateRedirectUrlAgainstTrustedDomains(`http://${hostname}`, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  });
}
