import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { createUrlIfValid, isLocalhost, matchHostnamePattern } from "@stackframe/stack-shared/dist/utils/urls";
import { Tenancy } from "./tenancies";

/**
 * Normalizes a URL to include explicit default ports for comparison
 */
function normalizePort(url: URL): string {
  const defaultPorts: Record<string, string> = { 'https:': '443', 'http:': '80' };
  const port = url.port || defaultPorts[url.protocol] || '';
  return port ? `${url.hostname}:${port}` : url.hostname;
}

/**
 * Checks if a URL uses the default port for its protocol
 */
function isDefaultPort(url: URL): boolean {
  return !url.port ||
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
}

/**
 * Checks if two URLs have matching ports (considering default ports)
 */
function portsMatch(url1: URL, url2: URL): boolean {
  return normalizePort(url1) === normalizePort(url2);
}

/**
 * Validates a URL against a domain pattern (with or without wildcards)
 */
function matchesDomain(testUrl: URL, pattern: string, handlerPath: string): boolean {
  const baseUrl = createUrlIfValid(pattern);

  // If pattern is invalid as a URL, it might contain wildcards
  if (!baseUrl || pattern.includes('*')) {
    // Parse wildcard pattern manually
    const match = pattern.match(/^([^:]+:\/\/)([^/]*)(.*)$/);
    if (!match) {
      captureError("invalid-redirect-domain", new StackAssertionError("Invalid domain pattern", { pattern }));
      return false;
    }

    const [, protocol, hostPattern, basePath] = match;

    // Check protocol
    if (testUrl.protocol + '//' !== protocol) {
      return false;
    }

    // Check host with wildcard pattern
    const hasPortInPattern = hostPattern.includes(':');
    if (hasPortInPattern) {
      // Pattern includes port - match against normalized host:port
      if (!matchHostnamePattern(hostPattern, normalizePort(testUrl))) {
        return false;
      }
    } else {
      // Pattern doesn't include port - match hostname only, require default port
      if (!matchHostnamePattern(hostPattern, testUrl.hostname) || !isDefaultPort(testUrl)) {
        return false;
      }
    }

    // Check path
    const fullPath = basePath === '/' ? handlerPath : basePath + handlerPath;
    return testUrl.pathname.startsWith(fullPath || '/');
  }

  // For non-wildcard patterns, use URL comparison
  return baseUrl.protocol === testUrl.protocol &&
         baseUrl.hostname === testUrl.hostname &&
         portsMatch(baseUrl, testUrl) &&
         testUrl.pathname.startsWith(handlerPath || '/');
}

export function validateRedirectUrl(
  urlOrString: string | URL,
  tenancy: Tenancy,
): boolean {
  const url = createUrlIfValid(urlOrString);
  if (!url) return false;

  // Check localhost permission
  if (tenancy.config.domains.allowLocalhost && isLocalhost(url)) {
    return true;
  }

  // Check trusted domains
  return Object.values(tenancy.config.domains.trustedDomains).some(domain =>
    domain.baseUrl && matchesDomain(url, domain.baseUrl, domain.handlerPath || '/')
  );
}
