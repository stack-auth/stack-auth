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
  list.addSubnet("224.0.0.0", 3, "ipv4");        // multicast + reserved (224.0.0.0/3 covers 240.0.0.0/4 too)
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
  // URL.hostname preserves brackets around IPv6 literals (e.g. "[::1]"); strip them so
  // the loopback check and DNS lookup see the literal address.
  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const isLoopbackHostname = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isDevLoopback = getNodeEnvironment() !== "production" && isLoopbackHostname;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isDevLoopback)) {
    return { kind: "error", reason: "URL must use https (http is only allowed for localhost in non-production)" };
  }
  // Fail closed on DNS errors: on this auth path, we'd rather reject than take a
  // chance that retry + rebinding lets a later resolution through the block.
  let resolved: LookupAddress[];
  try {
    resolved = await lookup(hostname, { all: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "error", reason: `DNS lookup failed for ${hostname}: ${reason}` };
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
  // Dotted tail forms: `::ffff:a.b.c.d` (IPv4-mapped) and `::a.b.c.d` (deprecated compat).
  for (const prefix of ["::ffff:", "::"]) {
    if (lower.startsWith(prefix)) {
      const tail = lower.slice(prefix.length);
      if (isIPv4(tail)) return tail;
    }
  }
  // Canonical hex form: `::ffff:7f00:1`. Expand the address to 8 fully-written groups,
  // then take the last two groups as the IPv4 octets. We only treat it as embedded v4
  // when the high 96 bits match ::ffff: (IPv4-mapped); IPv4-compatible (all zeros in
  // the top 96 bits) collapses to addresses like `::` which are already handled.
  const groups = expandIPv6Groups(lower);
  if (!groups) return null;
  const topAllZero = groups.slice(0, 5).every(g => g === 0);
  if (topAllZero && groups[5] === 0xffff) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    if (isIPv4(v4)) return v4;
  }
  return null;
}

// Expand a canonical/compressed IPv6 literal (e.g. `::ffff:7f00:1`, `2001:db8::1`) to
// its eight 16-bit groups. Returns null if the string isn't a valid IPv6 literal.
function expandIPv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  const [head, tail] = address.split("::") as [string, string | undefined];
  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = tail === undefined ? [] : (tail === "" ? [] : tail.split(":"));
  const totalGroups = headGroups.length + tailGroups.length;
  if (tail === undefined) {
    if (totalGroups !== 8) return null;
  } else if (totalGroups > 8) {
    return null;
  }
  const zerosNeeded = tail === undefined ? 0 : 8 - totalGroups;
  const fullGroups = [...headGroups, ...Array(zerosNeeded).fill("0"), ...tailGroups];
  const numeric = fullGroups.map(g => parseInt(g, 16));
  if (numeric.some(n => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  return numeric;
}
