import dns from "node:dns";
import net from "node:net";

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

export type DnsLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export function hostnameWithoutIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function normalizeIpv6Address(address: string): string {
  const hostname = hostnameWithoutIpv6Brackets(address);
  try {
    return hostnameWithoutIpv6Brackets(new URL(`http://[${hostname}]/`).hostname).toLowerCase();
  } catch (error) {
    return hostname.toLowerCase();
  }
}

function getIpv4MappedAddress(address: string): string | null {
  const prefix = "::ffff:";
  const normalizedAddress = normalizeIpv6Address(address);
  if (!normalizedAddress.startsWith(prefix)) {
    return null;
  }

  const mappedAddress = normalizedAddress.slice(prefix.length);
  if (net.isIP(mappedAddress) === 4) {
    return mappedAddress;
  }

  const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(mappedAddress);
  if (!hexMatch) {
    return null;
  }

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high > 0xffff || low > 0xffff) {
    return null;
  }

  return [
    high >> 8,
    high & 0xff,
    low >> 8,
    low & 0xff,
  ].join(".");
}

export function isBlockedPrivateOrReservedIpAddress(address: string): boolean {
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

export function assertPublicInternetResolvedAddress(address: string, error: Error): void {
  if (isBlockedPrivateOrReservedIpAddress(address)) {
    throw error;
  }
}

export async function assertHostnameResolvesToPublicInternet(hostname: string, error: Error): Promise<void> {
  const addresses = await dns.promises.lookup(hostnameWithoutIpv6Brackets(hostname), { all: true, verbatim: true });
  for (const address of addresses) {
    assertPublicInternetResolvedAddress(address.address, error);
  }
}

function getLookupValidationError(validate: () => void, fallbackMessage: string): NodeJS.ErrnoException | null {
  try {
    validate();
    return null;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(fallbackMessage);
  }
}

export function publicInternetDnsLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: DnsLookupCallback,
  error: Error,
): void {
  if (options.all) {
    const lookupOptions: dns.LookupAllOptions = { ...options, all: true };
    dns.lookup(hostname, lookupOptions, (lookupError, addresses) => {
      if (lookupError) {
        callback(lookupError, []);
        return;
      }

      const validationError = getLookupValidationError(() => {
        for (const address of addresses) {
          assertPublicInternetResolvedAddress(address.address, error);
        }
      }, "DNS lookup failed while validating resolved addresses.");
      if (validationError !== null) {
        callback(validationError, []);
        return;
      }
      callback(null, addresses);
    });
    return;
  }

  const lookupOptions: dns.LookupOneOptions = { ...options, all: false };
  dns.lookup(hostname, lookupOptions, (lookupError, address, family) => {
    if (lookupError) {
      callback(lookupError, "", 0);
      return;
    }

    const validationError = getLookupValidationError(
      () => assertPublicInternetResolvedAddress(address, error),
      "DNS lookup failed while validating resolved address.",
    );
    if (validationError !== null) {
      callback(validationError, "", 0);
      return;
    }
    callback(null, address, family);
  });
}
