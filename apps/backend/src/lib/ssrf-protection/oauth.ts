import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import {
  DnsLookupCallback,
  assertHostnameResolvesToPublicInternet,
  assertPublicInternetResolvedAddress,
  hostnameWithoutIpv6Brackets,
  isBlockedPrivateOrReservedIpAddress,
  publicInternetDnsLookup,
} from "./core";
import dns from "node:dns";
import net from "node:net";

const OAUTH_SSRF_PROTECTION_ERROR = "OAuth provider URLs must use HTTPS and resolve only to public internet addresses.";

function shouldEnforceOAuthSsrfProtection(): boolean {
  return !["development", "test"].includes(getNodeEnvironment());
}

export function isBlockedOAuthIpAddress(address: string): boolean {
  return isBlockedPrivateOrReservedIpAddress(address);
}

export function assertSafeOAuthUrlWithoutDns(urlString: string): URL {
  let url;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new StatusError(StatusError.BadRequest, "OAuth provider URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR);
  }

  if (isBlockedOAuthIpAddress(url.hostname)) {
    throw new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR);
  }

  return url;
}

export async function assertSafeOAuthUrl(urlString: string): Promise<void> {
  if (!shouldEnforceOAuthSsrfProtection()) {
    return;
  }

  const url = assertSafeOAuthUrlWithoutDns(urlString);
  const hostname = hostnameWithoutIpv6Brackets(url.hostname);
  if (net.isIP(hostname) !== 0) {
    return;
  }

  await assertHostnameResolvesToPublicInternet(hostname, new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR));
}

export function assertSafeOAuthResolvedAddress(address: string): void {
  assertPublicInternetResolvedAddress(address, new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR));
}

export function safeOAuthDnsLookup(hostname: string, options: dns.LookupOptions, callback: DnsLookupCallback): void {
  if (!shouldEnforceOAuthSsrfProtection()) {
    dns.lookup(hostname, options, callback);
    return;
  }

  publicInternetDnsLookup(
    hostname,
    options,
    callback,
    new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR),
  );
}
