import { StackAssertionError, captureError } from "./errors";
import { createUrlIfValid, isLocalhost, matchHostnamePattern } from "./urls";

type TrustedDomainConfig = {
  allowLocalhost?: boolean,
  trustedDomains: readonly (string | null | undefined)[],
};

const defaultPorts = new Map<string, string>([['https:', '443'], ['http:', '80']]);

function normalizePort(url: URL): string {
  const port = url.port || defaultPorts.get(url.protocol) || '';
  return port ? `${url.hostname}:${port}` : url.hostname;
}

function isDefaultPort(url: URL): boolean {
  return !url.port ||
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
}

function portsMatch(url1: URL, url2: URL): boolean {
  return normalizePort(url1) === normalizePort(url2);
}

function parseWildcardUrlPattern(pattern: string): { protocol: string, hostPattern: string } | null {
  const protocolSeparatorIndex = pattern.indexOf("://");
  if (protocolSeparatorIndex === -1) return null;

  const protocol = `${pattern.slice(0, protocolSeparatorIndex)}:`;
  const hostAndPath = pattern.slice(protocolSeparatorIndex + "://".length);
  const pathStartIndex = hostAndPath.indexOf("/");
  const hostPattern = pathStartIndex === -1 ? hostAndPath : hostAndPath.slice(0, pathStartIndex);
  if (hostPattern === "") return null;
  return { protocol, hostPattern };
}

function hostPatternWithoutPort(hostPattern: string): string {
  if (!hostPatternHasExplicitPort(hostPattern)) {
    return hostPattern;
  }
  const portSeparatorIndex = hostPattern.lastIndexOf(":");
  return hostPattern.slice(0, portSeparatorIndex);
}

function hostPatternHasExplicitPort(hostPattern: string): boolean {
  const portSeparatorIndex = hostPattern.lastIndexOf(":");
  if (portSeparatorIndex === -1) {
    return false;
  }
  const port = hostPattern.slice(portSeparatorIndex + 1);
  return port === "*" || (port !== "" && [...port].every(char => char >= "0" && char <= "9"));
}

function matchesTrustedDomain(testUrl: URL, pattern: string): boolean {
  const baseUrl = createUrlIfValid(pattern);

  if (baseUrl != null && !pattern.includes('*')) {
    return baseUrl.protocol === testUrl.protocol &&
      baseUrl.hostname === testUrl.hostname &&
      portsMatch(baseUrl, testUrl);
  }

  const parsedPattern = parseWildcardUrlPattern(pattern);
  if (parsedPattern == null) {
    captureError("invalid-redirect-domain", new StackAssertionError("Invalid domain pattern", { pattern }));
    return false;
  }

  if (testUrl.protocol !== parsedPattern.protocol) {
    return false;
  }

  const hasPortInPattern = hostPatternHasExplicitPort(parsedPattern.hostPattern);
  return hasPortInPattern
    ? matchHostnamePattern(parsedPattern.hostPattern, normalizePort(testUrl))
    : matchHostnamePattern(parsedPattern.hostPattern, testUrl.hostname) && isDefaultPort(testUrl);
}

export function isAcceptedNativeAppUrl(urlOrString: string): boolean {
  const url = createUrlIfValid(urlOrString);
  if (!url) return false;

  return url.protocol === 'stack-auth-mobile-oauth-url:';
}

export function validateRedirectUrl(
  urlOrString: string | URL,
  config: TrustedDomainConfig,
): boolean {
  const url = createUrlIfValid(urlOrString);
  if (!url) return false;

  if (config.allowLocalhost === true && isLocalhost(url)) {
    return true;
  }

  return config.trustedDomains.some(domain => domain != null && matchesTrustedDomain(url, domain));
}

export function getTrustedParentDomain(currentDomain: string, trustedDomains: readonly (string | null | undefined)[]): string | null {
  const hostPatterns = trustedDomains
    .filter((domain): domain is string => domain != null)
    .map((domain) => {
      const url = createUrlIfValid(domain);
      if (url != null && !domain.includes("*")) {
        return url.hostname.toLowerCase();
      }
      const parsedPattern = parseWildcardUrlPattern(domain);
      return parsedPattern == null ? null : hostPatternWithoutPort(parsedPattern.hostPattern).toLowerCase();
    })
    .filter((domain): domain is string => domain != null);

  const parts = currentDomain.toLowerCase().split('.');
  for (let i = parts.length - 2; i >= 0; i--) {
    const parentDomain = parts.slice(i).join('.');
    if (hostPatterns.includes(parentDomain) && hostPatterns.includes(`**.${parentDomain}`)) {
      return parentDomain;
    }
  }

  return null;
}

import.meta.vitest?.test("validateRedirectUrl matches exact and wildcard trusted domains", ({ expect }) => {
  expect(validateRedirectUrl("https://example.com", {
    allowLocalhost: false,
    trustedDomains: ["https://example.com"],
  })).toBe(true);
  expect(validateRedirectUrl("https://api.example.com", {
    allowLocalhost: false,
    trustedDomains: ["https://*.example.com"],
  })).toBe(true);
  expect(validateRedirectUrl("https://api.v2.example.com", {
    allowLocalhost: false,
    trustedDomains: ["https://*.example.com"],
  })).toBe(false);
});

import.meta.vitest?.test("validateRedirectUrl respects default and explicit ports", ({ expect }) => {
  expect(validateRedirectUrl("https://example.com:443/path", {
    allowLocalhost: false,
    trustedDomains: ["https://example.com"],
  })).toBe(true);
  expect(validateRedirectUrl("http://api.example.com:3000", {
    allowLocalhost: false,
    trustedDomains: ["http://*.example.com:3000"],
  })).toBe(true);
  expect(validateRedirectUrl("http://api.example.com", {
    allowLocalhost: false,
    trustedDomains: ["http://*.example.com:3000"],
  })).toBe(false);
  expect(validateRedirectUrl("http://api.example.com:1234", {
    allowLocalhost: false,
    trustedDomains: ["http://*.example.com:*"],
  })).toBe(true);
});

import.meta.vitest?.test("validateRedirectUrl respects localhost allowance and invalid patterns", ({ expect }) => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    expect(validateRedirectUrl("http://localhost:3000", {
      allowLocalhost: true,
      trustedDomains: [],
    })).toBe(true);
    expect(validateRedirectUrl("http://localhost:3000", {
      allowLocalhost: false,
      trustedDomains: [],
    })).toBe(false);
    expect(validateRedirectUrl("https://example.com", {
      allowLocalhost: false,
      trustedDomains: ["not a url"],
    })).toBe(false);
  } finally {
    console.error = originalConsoleError;
  }
});

import.meta.vitest?.test("getTrustedParentDomain ignores empty entries and strips ports", ({ expect }) => {
  expect(getTrustedParentDomain("app.example.com", [
    null,
    undefined,
    "https://example.com",
    "https://**.example.com:*",
  ])).toBe("example.com");
});
