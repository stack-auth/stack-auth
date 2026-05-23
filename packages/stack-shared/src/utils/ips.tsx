import ipRegex from "ip-regex";

export type Ipv4Address = `${number}.${number}.${number}.${number}`;
export type Ipv6Address = string;

export function isIpAddress(ip: string) {
  return ipRegex({ exact: true }).test(ip);
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255 || p !== String(n)) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

function isPrivateOrReservedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;                                    // 0.0.0.0/8 — "this" network
  if (a === 10) return true;                                   // 10.0.0.0/8 — private (RFC 1918)
  if (a === 100 && b >= 64 && b <= 127) return true;           // 100.64.0.0/10 — shared/CGNAT (RFC 6598)
  if (a === 127) return true;                                  // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true;                     // 169.254.0.0/16 — link-local
  if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16.0.0/12 — private (RFC 1918)
  if (a === 192 && b === 168) return true;                     // 192.168.0.0/16 — private (RFC 1918)
  if (a >= 224) return true;                                   // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/**
 * Expands an IPv6 address string to an array of 8 × 16-bit groups.
 * Returns null if the format is not recognised.
 */
function parseIpv6Groups(ip: string): number[] | null {
  // Handle IPv4-mapped/compatible suffix (e.g. ::ffff:192.168.1.1)
  let groups: string[];
  let ipv4Tail: [number, number, number, number] | null = null;

  const dotIdx = ip.indexOf(".");
  if (dotIdx !== -1) {
    const lastColon = ip.lastIndexOf(":", dotIdx);
    if (lastColon === -1) return null;
    const ipv4Part = ip.substring(lastColon + 1);
    ipv4Tail = parseIpv4Octets(ipv4Part);
    if (!ipv4Tail) return null;
    // Replace the IPv4 suffix with two 16-bit hex groups
    groups = ip.substring(0, lastColon).split(":").concat([
      ((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16),
      ((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16),
    ]);
  } else {
    groups = ip.split(":");
  }

  // Expand :: into the correct number of zero groups
  const doubleColonIdx = groups.indexOf("");
  if (doubleColonIdx !== -1) {
    // Handle leading/trailing :: producing extra empty strings
    const left = groups.slice(0, doubleColonIdx).filter(g => g !== "");
    const right = groups.slice(doubleColonIdx + 1).filter(g => g !== "");
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array(missing).fill("0"), ...right];
  }

  if (groups.length !== 8) return null;

  const parsed = groups.map(g => parseInt(g, 16));
  if (parsed.some(n => isNaN(n) || n < 0 || n > 0xffff)) return null;
  return parsed;
}

function isPrivateOrReservedIpv6(groups: number[]): boolean {
  // :: (unspecified) — all zeros
  if (groups.every(g => g === 0)) return true;

  // ::1 (loopback)
  if (groups.slice(0, 7).every(g => g === 0) && groups[7] === 1) return true;

  // ::ffff:0:0/96 — IPv4-mapped; check the embedded IPv4 part
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    const a = (groups[6]! >> 8) & 0xff;
    const b = groups[6]! & 0xff;
    const c = (groups[7]! >> 8) & 0xff;
    const d = groups[7]! & 0xff;
    return isPrivateOrReservedIpv4([a, b, c, d]);
  }

  // fc00::/7 — unique local address (ULA)
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;

  // fe80::/10 — link-local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;

  // ff00::/8 — multicast
  if ((groups[0]! & 0xff00) === 0xff00) return true;

  // 100::/64 — discard prefix
  if (groups[0] === 0x0100 && groups.slice(1, 4).every(g => g === 0)) return true;

  // 2001:db8::/32 — documentation
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

  return false;
}

/**
 * Returns true if the given IP address belongs to a private, loopback, link-local,
 * or otherwise reserved network range that should not be reachable from the public internet.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!isIpAddress(ip)) return false;

  const ipv4 = parseIpv4Octets(ip);
  if (ipv4) return isPrivateOrReservedIpv4(ipv4);

  const ipv6 = parseIpv6Groups(ip);
  if (ipv6) return isPrivateOrReservedIpv6(ipv6);

  return false;
}

import.meta.vitest?.test("isPrivateOrReservedIp", ({ expect }) => {
  // IPv4 private/reserved
  expect(isPrivateOrReservedIp("0.0.0.0")).toBe(true);
  expect(isPrivateOrReservedIp("0.1.2.3")).toBe(true);
  expect(isPrivateOrReservedIp("10.0.0.1")).toBe(true);
  expect(isPrivateOrReservedIp("10.255.255.255")).toBe(true);
  expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
  expect(isPrivateOrReservedIp("100.127.255.255")).toBe(true);
  expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
  expect(isPrivateOrReservedIp("127.255.255.255")).toBe(true);
  expect(isPrivateOrReservedIp("169.254.1.1")).toBe(true);
  expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
  expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
  expect(isPrivateOrReservedIp("192.168.0.1")).toBe(true);
  expect(isPrivateOrReservedIp("192.168.255.255")).toBe(true);
  expect(isPrivateOrReservedIp("224.0.0.1")).toBe(true);   // multicast
  expect(isPrivateOrReservedIp("240.0.0.1")).toBe(true);   // reserved
  expect(isPrivateOrReservedIp("255.255.255.255")).toBe(true);

  // IPv4 public
  expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
  expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
  expect(isPrivateOrReservedIp("100.63.255.255")).toBe(false); // just below CGNAT
  expect(isPrivateOrReservedIp("100.128.0.0")).toBe(false);    // just above CGNAT
  expect(isPrivateOrReservedIp("172.15.255.255")).toBe(false);
  expect(isPrivateOrReservedIp("172.32.0.0")).toBe(false);
  expect(isPrivateOrReservedIp("223.255.255.255")).toBe(false);

  // IPv6 private/reserved
  expect(isPrivateOrReservedIp("::")).toBe(true);              // unspecified
  expect(isPrivateOrReservedIp("::1")).toBe(true);             // loopback
  expect(isPrivateOrReservedIp("fc00::1")).toBe(true);         // ULA
  expect(isPrivateOrReservedIp("fd12:3456::1")).toBe(true);    // ULA
  expect(isPrivateOrReservedIp("fe80::1")).toBe(true);         // link-local
  expect(isPrivateOrReservedIp("ff02::1")).toBe(true);         // multicast
  expect(isPrivateOrReservedIp("2001:db8::1")).toBe(true);     // documentation
  expect(isPrivateOrReservedIp("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped loopback
  expect(isPrivateOrReservedIp("::ffff:192.168.1.1")).toBe(true); // IPv4-mapped private

  // IPv6 public
  expect(isPrivateOrReservedIp("2001:4860:4860::8888")).toBe(false); // Google DNS
  expect(isPrivateOrReservedIp("2606:4700::1111")).toBe(false);      // Cloudflare
  expect(isPrivateOrReservedIp("::ffff:8.8.8.8")).toBe(false);      // IPv4-mapped public

  // Invalid input
  expect(isPrivateOrReservedIp("not-an-ip")).toBe(false);
  expect(isPrivateOrReservedIp("")).toBe(false);
});
import.meta.vitest?.test("isIpAddress", ({ expect }) => {
  // Test valid IPv4 addresses
  expect(isIpAddress("192.168.1.1")).toBe(true);
  expect(isIpAddress("127.0.0.1")).toBe(true);
  expect(isIpAddress("0.0.0.0")).toBe(true);
  expect(isIpAddress("255.255.255.255")).toBe(true);

  // Test valid IPv6 addresses
  expect(isIpAddress("::1")).toBe(true);
  expect(isIpAddress("2001:db8::")).toBe(true);
  expect(isIpAddress("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe(true);

  // Test invalid IP addresses
  expect(isIpAddress("")).toBe(false);
  expect(isIpAddress("not an ip")).toBe(false);
  expect(isIpAddress("256.256.256.256")).toBe(false);
  expect(isIpAddress("192.168.1")).toBe(false);
  expect(isIpAddress("192.168.1.1.1")).toBe(false);
  expect(isIpAddress("2001:db8::xyz")).toBe(false);
});

export function assertIpAddress(ip: string): asserts ip is Ipv4Address | Ipv6Address {
  if (!isIpAddress(ip)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
}
import.meta.vitest?.test("assertIpAddress", ({ expect }) => {
  // Test with valid IPv4 address
  expect(() => assertIpAddress("192.168.1.1")).not.toThrow();

  // Test with valid IPv6 address
  expect(() => assertIpAddress("::1")).not.toThrow();

  // Test with invalid IP addresses
  expect(() => assertIpAddress("")).toThrow("Invalid IP address: ");
  expect(() => assertIpAddress("not an ip")).toThrow("Invalid IP address: not an ip");
  expect(() => assertIpAddress("256.256.256.256")).toThrow("Invalid IP address: 256.256.256.256");
  expect(() => assertIpAddress("192.168.1")).toThrow("Invalid IP address: 192.168.1");
});
