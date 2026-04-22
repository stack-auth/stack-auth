import { lookup } from "node:dns/promises";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";

type LookupAddress = { address: string, family: number };

export type SafeFetchUrlResult =
  | { kind: "ok", url: URL }
  | { kind: "error", reason: string };

// Precomputed blocklist of CIDR ranges the server must never dereference. Covers
// loopback, RFC1918, link-local + cloud metadata, CGNAT, multicast/reserved for
// IPv4, and loopback/unspecified/link-local/unique-local/site-local/multicast for
// IPv6. `net.BlockList` gives us numeric subnet matching so we don't rely on
// string-prefix heuristics that tend to grow subtle gaps.
const BLOCKED_RANGES: BlockList = (() => {
  const list = new BlockList();
  // IPv4
  list.addSubnet("0.0.0.0", 8, "ipv4");          // "this network" / unspecified
  list.addSubnet("10.0.0.0", 8, "ipv4");         // RFC1918
  list.addSubnet("127.0.0.0", 8, "ipv4");        // loopback
  list.addSubnet("169.254.0.0", 16, "ipv4");     // link-local + cloud metadata (169.254.169.254)
  list.addSubnet("172.16.0.0", 12, "ipv4");      // RFC1918
  list.addSubnet("192.168.0.0", 16, "ipv4");     // RFC1918
  list.addSubnet("100.64.0.0", 10, "ipv4");      // CGNAT
  list.addSubnet("224.0.0.0", 4, "ipv4");        // multicast + reserved (224.0.0.0/3)
  // IPv6
  list.addAddress("::", "ipv6");                  // unspecified
  list.addAddress("::1", "ipv6");                 // loopback
  list.addSubnet("fe80::", 10, "ipv6");          // link-local
  list.addSubnet("fc00::", 7, "ipv6");           // unique-local
  list.addSubnet("fec0::", 10, "ipv6");          // site-local (deprecated but still routable)
  list.addSubnet("ff00::", 8, "ipv6");           // multicast
  return list;
})();

/**
 * Screens a URL before the server dereferences it to an external network resource.
 * Rejects URLs that would expose internal services via SSRF: non-http(s) schemes,
 * plain http outside of dev-loopback, and hostnames that resolve to addresses in
 * BLOCKED_RANGES.
 *
 * First line of defense only. DNS rebinding (lookup here ≠ lookup at fetch time)
 * would require pinning fetch to the resolved IP via a custom Agent.
 */
export async function validateSafeFetchUrl(raw: string): Promise<SafeFetchUrlResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "error", reason: "invalid URL" };
  }
  const isLoopbackHostname = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  const isDevLoopback = getNodeEnvironment() !== "production" && isLoopbackHostname;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isDevLoopback)) {
    return { kind: "error", reason: "URL must use https (http is only allowed for localhost in non-production)" };
  }
  // Unresolvable hostnames aren't SSRF targets — let the downstream fetch surface
  // the real DNS error instead of synthesizing one here.
  let resolved: LookupAddress[] = [];
  try {
    resolved = await lookup(url.hostname, { all: true });
  } catch {
    return { kind: "ok", url };
  }
  for (const { address } of resolved) {
    if (isBlockedAddress(address) && !isDevLoopback) {
      return { kind: "error", reason: "hostname resolves to a disallowed IP range" };
    }
  }
  return { kind: "ok", url };
}

function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return BLOCKED_RANGES.check(address, "ipv4");
  if (isIPv6(address)) {
    // Normalize IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
    // forms so they're tested against the IPv4 ruleset rather than matched
    // opportunistically as IPv6.
    const embedded = extractEmbeddedIPv4(address);
    if (embedded !== null) return BLOCKED_RANGES.check(embedded, "ipv4");
    return BLOCKED_RANGES.check(address, "ipv6");
  }
  // Not a valid IP literal — be conservative and block.
  return true;
}

function extractEmbeddedIPv4(address: string): string | null {
  const lower = address.toLowerCase();
  const prefixes = ["::ffff:", "::"];
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      const tail = lower.slice(prefix.length);
      if (isIPv4(tail)) return tail;
    }
  }
  return null;
}
