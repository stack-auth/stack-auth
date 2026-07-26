import { getEnvVariable, getProcessEnv } from "@hexclave/shared/dist/utils/env";
import { getHostedHandlerTrustedDomain as getHostedHandlerTrustedDomainFromConfig, isAcceptedNativeAppUrl, validateRedirectUrl as validateRedirectUrlAgainstTrustedDomains } from "@hexclave/shared/dist/utils/redirect-urls";
import { createUrlIfValid } from "@hexclave/shared/dist/utils/urls";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { Tenancy } from "./tenancies";

export { isAcceptedNativeAppUrl };

type RedirectTenancy = Pick<Tenancy, "deployedDomains"> & {
  config: Pick<Tenancy["config"], "domains">,
  project: Pick<Tenancy["project"], "id">,
};

export function getHostedHandlerTrustedDomain(projectId: string): string {
  return getHostedHandlerTrustedDomainFromConfig({
    projectId,
    hostedHandlerDomainSuffix: getProcessEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX"),
    hostedHandlerUrlTemplate: getProcessEnv("NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE"),
    hexclavePortPrefix: getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81"),
  });
}

export function getTrustedDomainsForTenancy(tenancy: RedirectTenancy): string[] {
  return [
    ...Object.values(tenancy.config.domains.trustedDomains)
      .map(domain => domain.baseUrl)
      .filter((baseUrl): baseUrl is string => baseUrl != null),
    ...getDeployedOrigins(tenancy),
    getHostedHandlerTrustedDomain(tenancy.project.id),
  ];
}

export function getOAuthRedirectUrisForTenancy(tenancy: RedirectTenancy): string[] {
  return [
    ...Object.values(tenancy.config.domains.trustedDomains)
      .filter((domain) => domain.baseUrl)
      .map((domain) => new URL(domain.handlerPath, domain.baseUrl).toString()),
    ...getDeployedOrigins(tenancy).map((origin) => new URL("/handler/oauth-callback", origin).toString()),
    new URL("/handler/oauth-callback", getHostedHandlerTrustedDomain(tenancy.project.id)).toString(),
  ];
}

function getDeployedOrigins(tenancy: RedirectTenancy): string[] {
  return tenancy.deployedDomains
    .map((domain) => {
      // Deployment URLs are public HTTPS origins even when Vercel returns a
      // bare host or a stored value includes a scheme/path.
      const url = createUrlIfValid(domain.includes("://") ? domain : `https://${domain}`);
      if (url == null || !["http:", "https:"].includes(url.protocol) || url.hostname === "") {
        captureError("invalid-deployment-domain", new HexclaveAssertionError("A deployment domain could not be normalized for redirect validation.", {
          domain,
        }));
        return null;
      }
      return `https://${url.host}`;
    })
    .filter((origin): origin is string => origin != null);
}

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: RedirectTenancy,
): boolean {
  return validateRedirectUrlAgainstTrustedDomains(urlOrString, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  });
}

export function validateRedirectHostname(hostname: string, tenancy: RedirectTenancy): boolean {
  return validateRedirectUrlAgainstTrustedDomains(`https://${hostname}`, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  }) || validateRedirectUrlAgainstTrustedDomains(`http://${hostname}`, {
    allowLocalhost: tenancy.config.domains.allowLocalhost,
    trustedDomains: getTrustedDomainsForTenancy(tenancy),
  });
}
