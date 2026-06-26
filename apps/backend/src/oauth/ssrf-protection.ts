import dns from "node:dns";
import net from "node:net";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";

const OAUTH_SSRF_PROTECTION_ERROR = "OAuth provider URLs must use HTTPS and resolve only to public internet addresses.";

const blockedAddressRanges = new net.BlockList();
for (const [address, prefix, type] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001::", 23, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
] as const) {
  blockedAddressRanges.addSubnet(address, prefix, type);
}

function shouldEnforceOAuthSsrfProtection(): boolean {
  return !["development", "test"].includes(getNodeEnvironment());
}

function hostnameWithoutIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function getIpv4MappedAddress(address: string): string | null {
  const prefix = "::ffff:";
  if (!address.toLowerCase().startsWith(prefix)) {
    return null;
  }

  const mappedAddress = address.slice(prefix.length);
  return net.isIP(mappedAddress) === 4 ? mappedAddress : null;
}

export function isBlockedOAuthIpAddress(address: string): boolean {
  const normalizedAddress = hostnameWithoutIpv6Brackets(address);
  const ipVersion = net.isIP(normalizedAddress);
  if (ipVersion === 4) {
    return blockedAddressRanges.check(normalizedAddress, "ipv4");
  }
  if (ipVersion === 6) {
    const mappedAddress = getIpv4MappedAddress(normalizedAddress);
    if (mappedAddress !== null) {
      return blockedAddressRanges.check(mappedAddress, "ipv4");
    }
    return blockedAddressRanges.check(normalizedAddress, "ipv6");
  }
  return false;
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

  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    assertSafeOAuthResolvedAddress(address.address);
  }
}

export function assertSafeOAuthResolvedAddress(address: string): void {
  if (isBlockedOAuthIpAddress(address)) {
    throw new StatusError(StatusError.BadRequest, OAUTH_SSRF_PROTECTION_ERROR);
  }
}

type DnsLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export function safeOAuthDnsLookup(hostname: string, options: dns.LookupOptions, callback: DnsLookupCallback): void {
  if (!shouldEnforceOAuthSsrfProtection()) {
    dns.lookup(hostname, options, callback);
    return;
  }

  if (options.all) {
    const lookupOptions: dns.LookupAllOptions = { ...options, all: true };
    dns.lookup(hostname, lookupOptions, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }

      for (const address of addresses) {
        assertSafeOAuthResolvedAddress(address.address);
      }
      callback(null, addresses);
    });
    return;
  }

  const lookupOptions: dns.LookupOneOptions = { ...options, all: false };
  dns.lookup(hostname, lookupOptions, (error, address, family) => {
    if (error) {
      callback(error, "", 0);
      return;
    }

    assertSafeOAuthResolvedAddress(address);
    callback(null, address, family);
  });
}
