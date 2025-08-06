import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createUrlIfValid, isLocalhost, matchHostnamePattern } from "@stackframe/stack-shared/dist/utils/urls";
import { Tenancy } from "./tenancies";

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: Tenancy,
): boolean {
  const url = createUrlIfValid(urlOrString);
  if (!url) return false;
  if (tenancy.config.domains.allowLocalhost && isLocalhost(url)) {
    return true;
  }
  return Object.values(tenancy.config.domains.trustedDomains).some((domain) => {
    if (!domain.baseUrl) {
      return false;
    }

    const testUrl = url;

    // Check if the domain uses wildcards
    const hasWildcard = domain.baseUrl.includes('*');

    if (hasWildcard) {
      // For wildcard domains, we need to parse the pattern manually
      // Extract protocol, hostname pattern, and path
      const protocolEnd = domain.baseUrl.indexOf('://');
      if (protocolEnd === -1) {
        captureError("invalid-redirect-domain", new StackAssertionError("Invalid domain format; missing protocol", {
          domain: domain.baseUrl,
        }));
        return false;
      }

      const protocol = domain.baseUrl.substring(0, protocolEnd + 3);
      const afterProtocol = domain.baseUrl.substring(protocolEnd + 3);
      const pathStart = afterProtocol.indexOf('/');
      const hostPattern = pathStart === -1 ? afterProtocol : afterProtocol.substring(0, pathStart);
      const basePath = pathStart === -1 ? '/' : afterProtocol.substring(pathStart);

      // Check protocol
      if (testUrl.protocol + '//' !== protocol) {
        return false;
      }

      // Check host (including port) with wildcard pattern
      // We need to handle port matching correctly
      const hasPortInPattern = hostPattern.includes(':');

      if (hasPortInPattern) {
        // Pattern includes port - match against full host (hostname:port)
        // Need to normalize for default ports
        let normalizedTestHost = testUrl.host;
        if (testUrl.port === '' ||
            (testUrl.protocol === 'https:' && testUrl.port === '443') ||
            (testUrl.protocol === 'http:' && testUrl.port === '80')) {
          // Add default port explicitly for matching when pattern has a port
          const defaultPort = testUrl.protocol === 'https:' ? '443' : '80';
          normalizedTestHost = testUrl.hostname + ':' + (testUrl.port || defaultPort);
        }

        if (!matchHostnamePattern(hostPattern, normalizedTestHost)) {
          return false;
        }
      } else {
        // Pattern doesn't include port - match hostname only and check port separately
        if (!matchHostnamePattern(hostPattern, testUrl.hostname)) {
          return false;
        }

        // When no port is specified in pattern, only allow default ports
        const isDefaultPort =
          (testUrl.protocol === 'https:' && (testUrl.port === '' || testUrl.port === '443')) ||
          (testUrl.protocol === 'http:' && (testUrl.port === '' || testUrl.port === '80'));

        if (!isDefaultPort) {
          return false;
        }
      }

      // Check path
      const handlerPath = domain.handlerPath || '/';
      const fullBasePath = basePath === '/' ? handlerPath : basePath + handlerPath;
      return testUrl.pathname.startsWith(fullBasePath);
    } else {
      // For non-wildcard domains, use the original logic
      const baseUrl = createUrlIfValid(domain.baseUrl);
      if (!baseUrl) {
        captureError("invalid-redirect-domain", new StackAssertionError("Invalid redirect domain; maybe this should be fixed in the database", {
          domain: domain.baseUrl,
        }));
        return false;
      }

      const protocolMatches = baseUrl.protocol === testUrl.protocol;
      const hostnameMatches = baseUrl.hostname === testUrl.hostname;

      // Check port matching for non-wildcard domains
      const portMatches = baseUrl.port === testUrl.port ||
        (baseUrl.port === '' && testUrl.protocol === 'https:' && testUrl.port === '443') ||
        (baseUrl.port === '' && testUrl.protocol === 'http:' && testUrl.port === '80') ||
        (testUrl.port === '' && baseUrl.protocol === 'https:' && baseUrl.port === '443') ||
        (testUrl.port === '' && baseUrl.protocol === 'http:' && baseUrl.port === '80');

      const pathMatches = testUrl.pathname.startsWith(domain.handlerPath || '/');

      return protocolMatches && hostnameMatches && portMatches && pathMatches;
    }
  });
}
