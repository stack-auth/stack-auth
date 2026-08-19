// Resolving an image reference to the exact bytes a machine will run.
//
// A TAG is a pointer the publisher can move: two machines of one service,
// started ten minutes apart, can pull different images while Marshal calls them
// one revision. So a tag is resolved to a DIGEST once, when the deployment is
// created, and the digest is what every apply of that deployment names. A
// redeploy resolves again, which is how a moved tag is picked up — deliberately,
// and at a moment that is recorded.
//
// A reference that ALREADY names a digest is checked here too. The digest fixes
// which bytes, so there is nothing to resolve — but "does this image exist",
// "can it be pulled without credentials" and "does it run on amd64" are separate
// questions, and answering them here is what keeps a bad reference a 400 on the
// deploy request instead of a machine that will not start.
//
// This is also the only place Marshal makes an outbound request to a host the
// USER chose, so it carries the guards that go with that: no private-network
// destinations, a bounded number of redirects each re-checked, a short timeout,
// and a small response cap. Requests are pinned to the address that was
// validated (see registryGet) so that a name resolving differently a moment
// later cannot move the connection somewhere the check would have refused.

import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import { createHash } from "node:crypto";
import { getConfig } from "./config.js";
import { badRequest } from "./errors.js";
import { isImageDigest, type ImageRef } from "./image-ref.js";

// Per-connection INACTIVITY timeout: a registry that stops sending mid-response
// is abandoned rather than held open.
const REGISTRY_IDLE_TIMEOUT_MS = 10_000;
// Wall-clock budget for resolving ONE reference, covering DNS, every redirect
// hop, and the token handshake.
//
// The idle timeout alone is not a bound: it is reset by every byte, so a host
// that dribbles one byte just under the limit holds the connection open for as
// long as it likes — and a deployment resolves its targets sequentially while
// holding the source lease, so that stalls far more than one request. This is
// the deadline that actually ends it.
const REGISTRY_TOTAL_TIMEOUT_MS = 20_000;
// A manifest is kilobytes. Anything larger is not one, and must not be buffered
// just to find that out.
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
// Registries redirect (most often to a CDN); each hop is re-validated, and the
// chain is bounded so a redirect loop cannot hold the request open.
const MAX_REDIRECTS = 3;

// Both the OCI and the older Docker media types, in both their single-manifest
// and multi-platform spellings. A registry serves whichever the image was pushed
// with, so asking for one of them is how an image ends up "not found".
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

// Fly machines are amd64. An image with no amd64 variant fails at PULL time,
// which surfaces as a machine that will not start rather than as anything about
// architectures — so it is checked here, where the manifest can still say why.
const REQUIRED_ARCHITECTURE = "amd64";
const REQUIRED_OS = "linux";

/**
 * Resolves a reference to the digest-pinned ref a machine will run, having
 * checked that the image exists, is publicly pullable, and can run on amd64.
 *
 * Both spellings go through the registry: a tag because its digest is unknown,
 * and a digest because everything OTHER than which-bytes is still unknown.
 */
export async function resolveImage(ref: ImageRef): Promise<string> {
  const digest = getConfig().registryKind === "mock"
    // The mock stands in for the whole registry, digests included: an e2e run
    // must not depend on a public registry being reachable.
    ? ref.digest ?? mockDigestFor(ref)
    : await resolveFromRegistry(ref);
  // Fully qualified and digest-pinned: "docker.io/library/postgres@sha256:...".
  // This is what goes into the spec's `source.image`.
  return `${ref.registry}/${ref.repository}@${digest}`;
}

/**
 * A deterministic fake digest, for the same reason the mock builder mints them:
 * an e2e run must not depend on a public registry being reachable, and image
 * mapping assertions need a stable value. Derived from the reference, so two
 * different tags resolve differently and the same tag resolves the same way.
 */
function mockDigestFor(ref: ImageRef): string {
  return `sha256:${createHash("sha256").update(`mock-image:${ref.canonical}`).digest("hex")}`;
}

/**
 * Fetches the manifest and returns the digest the registry reports for it.
 *
 * `reference` is the tag or the digest — the registry API takes either in the
 * same position, which is what lets one path answer both.
 */
async function resolveFromRegistry(ref: ImageRef): Promise<string> {
  // Docker Hub's registry API lives on a different host from the name that
  // appears in references.
  const host = ref.registry === "docker.io" ? "registry-1.docker.io" : ref.registry;
  // `validateImageRef` guarantees one of the two, but the TYPE permits neither —
  // so this states it rather than interpolating `null` into the URL and having
  // the registry report a perfectly real image as missing.
  const reference = ref.digest ?? ref.tag;
  if (reference === null) throw badRequest(`the image ${ref.canonical} names neither a tag nor a digest`);
  const url = `https://${host}/v2/${ref.repository}/manifests/${reference}`;

  // One budget for the whole resolution, not one per request: the handshake can
  // take three round trips and each may redirect, so a per-request bound would
  // still multiply out to minutes.
  const deadline = Date.now() + REGISTRY_TOTAL_TIMEOUT_MS;

  let response = await registryGet(url, {}, deadline);
  if (response.status === 401) {
    // The standard anonymous-pull handshake: the challenge names where to get a
    // token for this repository, and the token is scoped to it.
    const token = await fetchAnonymousToken(response.header("www-authenticate"), ref, deadline);
    if (token !== null) {
      response = await registryGet(url, { Authorization: `Bearer ${token}` }, deadline);
    }
  }

  if (response.status === 401 || response.status === 403) {
    throw badRequest(`the image ${ref.canonical} could not be pulled: the registry requires authentication. Only public images are supported`);
  }
  if (response.status === 404) {
    throw badRequest(`the image ${ref.canonical} does not exist in the registry (no such repository, tag or digest)`);
  }
  if (response.status < 200 || response.status > 299) {
    // A registry outage is not the author's mistake, and must not read like one.
    throw badRequest(`the registry did not answer for ${ref.canonical} (HTTP ${response.status}). This is a problem reaching the registry, not with the image reference; try again`);
  }

  // The digest of the manifest as the registry computed it. Preferred over
  // hashing the body: the two must agree, and the registry's answer is the one
  // a puller will look for.
  const reported = response.header("docker-content-digest");
  if (reported === null || !isImageDigest(reported)) {
    throw badRequest(`the registry did not return a usable digest for ${ref.canonical}`);
  }
  // When the caller already named a digest, the registry must agree it is the
  // one it just served. A mismatch means something between us and the registry
  // is answering for a different image, which is not a deploy to continue.
  if (ref.digest !== null && reported !== ref.digest) {
    throw badRequest(`the registry served a different image than ${ref.canonical} (it reported ${reported})`);
  }
  assertRunnableOnAmd64(response.body, ref);
  return reported;
}

/**
 * Fails a multi-platform image that has no linux/amd64 variant.
 *
 * Exported for tests: the bodies it has to survive are attacker-shaped, and
 * driving them through a live registry is not a thing a unit test can do.
 *
 * Only a manifest LIST can be checked from the manifest alone: a single-platform
 * manifest states its platform in its config blob, which is another request and
 * another failure mode. The list case is the one that actually reaches us —
 * an image published for several architectures but not ours — so it is the one
 * that gets a real error instead of an unstartable machine.
 */
export function assertRunnableOnAmd64(body: string, ref: ImageRef): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return; // Not something we can read; the pull is the authority.
  }
  // The body comes from a registry the tenant named, so it is not necessarily a
  // manifest — or an object at all. `JSON.parse("null")` returns null, and
  // reading a property off it throws a TypeError, which is not a badRequest and
  // would escape while the caller holds the source reconciliation lease.
  if (!isRecord(parsed)) return;
  const manifests = parsed.manifests;
  if (!Array.isArray(manifests) || manifests.length === 0) return;
  const platforms = manifests.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.platform)) return [];
    const platform = entry.platform;
    if (typeof platform.os !== "string" || typeof platform.architecture !== "string") return [];
    return [{ os: platform.os, architecture: platform.architecture }];
  });
  if (platforms.length === 0) return;
  if (platforms.some((platform) => platform.os === REQUIRED_OS && platform.architecture === REQUIRED_ARCHITECTURE)) return;
  const available = [...new Set(platforms.map((platform) => `${platform.os}/${platform.architecture}`))].sort().join(", ");
  throw badRequest(`the image ${ref.canonical} has no ${REQUIRED_OS}/${REQUIRED_ARCHITECTURE} variant (it is published for ${available}), and services run on ${REQUIRED_OS}/${REQUIRED_ARCHITECTURE}`);
}

/**
 * Follows a `WWW-Authenticate: Bearer realm=..., service=...` challenge to an
 * anonymous pull token. Returns null when the challenge is not one we can
 * answer, which leaves the caller to report the 401 as "not public".
 */
async function fetchAnonymousToken(challenge: string | null, ref: ImageRef, deadline: number): Promise<string | null> {
  if (challenge === null || !/^Bearer\s/i.test(challenge)) return null;
  const parameters = new Map<string, string>();
  for (const match of challenge.slice("Bearer".length).matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) {
    parameters.set(match[1].toLowerCase(), match[2]);
  }
  const realm = parameters.get("realm");
  if (realm === undefined) return null;
  let realmUrl: URL;
  try {
    realmUrl = new URL(realm);
  } catch {
    return null;
  }
  // The realm is a URL the REGISTRY chose, so it is as user-influenced as the
  // registry host itself and goes through the same guards.
  if (realmUrl.protocol !== "https:") return null;
  realmUrl.searchParams.set("scope", `repository:${ref.repository}:pull`);
  const service = parameters.get("service");
  if (service !== undefined) realmUrl.searchParams.set("service", service);

  const response = await registryGet(realmUrl.toString(), {}, deadline);
  if (response.status < 200 || response.status > 299) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return null;
  }
  // Same reason as above: a token endpoint answering `null` must not crash the
  // deployment that asked.
  if (!isRecord(parsed)) return null;
  // Registries disagree about which of the two names they use.
  return typeof parsed.token === "string" ? parsed.token : (typeof parsed.access_token === "string" ? parsed.access_token : null);
}

type RegistryResponse = {
  status: number,
  body: string,
  header: (name: string) => string | null,
};

/**
 * One request to a user-influenced host, with the guards that implies.
 *
 * Redirects are followed BY HAND rather than by the HTTP client, because each
 * hop is a new destination that has to pass the private-network check: a
 * registry that redirects to "http://169.254.169.254/" must not be followed just
 * because the first hop was fine.
 */
async function registryGet(url: string, headers: Record<string, string>, deadline: number): Promise<RegistryResponse> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    assertBeforeDeadline(deadline);
    const target = parseHttpsUrl(current);
    const addresses = await resolvePublicAddresses(target.hostname);
    const response = await httpsGetPinned(target, headers, addresses[0], deadline);
    if (response.status < 300 || response.status > 399) return response;
    const location = response.header("location");
    if (location === null) return response;
    try {
      current = new URL(location, current).toString();
    } catch {
      return response;
    }
    // A redirect carries no Authorization: the token was minted for the
    // registry, and forwarding it to whatever host the registry names would hand
    // a bearer token to a third party.
    headers = {};
  }
  throw badRequest("the registry redirected too many times");
}

/**
 * Whether a parsed JSON value is an object whose properties can be read. Guards
 * every read of a registry's response body: those bodies are attacker-shaped,
 * and `null` in particular is a legal JSON document that a property read throws
 * on.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Ends a resolution that has already spent its whole budget. */
function assertBeforeDeadline(deadline: number): void {
  if (Date.now() >= deadline) throw badRequest("resolving the image took too long");
}

function parseHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest(`invalid registry URL ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:") {
    throw badRequest(`registries must be reached over https (got ${parsed.protocol.replace(":", "")})`);
  }
  return parsed;
}

/**
 * Every address a registry hostname resolves to, having checked that all of them
 * are public.
 *
 * This is the SSRF boundary: the host comes from the user's deploy file, and
 * Marshal runs where it can reach infrastructure the user cannot. EVERY address
 * the name resolves to has to be public — a name resolving to both a public and
 * a private address is refused, since which one a connection picks is not ours
 * to decide.
 *
 * The addresses are RETURNED rather than merely approved because the connection
 * is pinned to one of them (see httpsGetPinned). Validating a name and then
 * letting the HTTP client resolve it again is a DNS-rebinding hole: the second
 * lookup can answer with a private address that this check never saw.
 */
async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(bare) !== 0
    ? [bare]
    : (await dns.lookup(bare, { all: true }).catch(() => {
      throw badRequest(`the registry host ${JSON.stringify(bare)} could not be resolved`);
    })).map((entry) => entry.address);
  if (addresses.length === 0) throw badRequest(`the registry host ${JSON.stringify(bare)} could not be resolved`);
  for (const address of addresses) {
    if (!isPublicAddress(address)) {
      throw badRequest(`the registry host ${JSON.stringify(bare)} resolves to a non-public address`);
    }
  }
  return addresses;
}

/**
 * A GET whose TCP connection goes to `address` — the one already validated —
 * while TLS and the Host header still use the hostname, so certificate
 * verification and virtual hosting keep working.
 *
 * `lookup` is the pinning mechanism: Node hands DNS resolution to it, and this
 * one ignores the name and answers with the address that was checked. Without
 * it the client would resolve the name a second time, and the answer to that
 * second lookup is not the answer this request was authorized against.
 */
function httpsGetPinned(url: URL, headers: Record<string, string>, address: string, deadline: number): Promise<RegistryResponse> {
  return new Promise((resolve, reject) => {
    // The absolute cutoff. `request.setTimeout` below only fires on INACTIVITY
    // and is reset by every byte received, so it cannot bound a slow drip; this
    // timer destroys the request whatever the socket is doing.
    const deadlineTimer = setTimeout(() => {
      request.destroy();
      reject(badRequest(`the registry ${url.hostname} took too long to answer`));
    }, Math.max(0, deadline - Date.now()));
    // Nothing should be kept alive purely by this timer.
    deadlineTimer.unref();
    const settle = <T>(finish: (value: T) => void) => (value: T) => {
      clearTimeout(deadlineTimer);
      finish(value);
    };
    const succeed = settle(resolve);
    const fail = settle(reject);
    const request = https.request({
      hostname: url.hostname,
      port: url.port === "" ? 443 : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // SNI and certificate validation follow the NAME, not the pinned address.
      servername: url.hostname,
      headers: { Accept: MANIFEST_ACCEPT, "User-Agent": "hexclave-marshal", ...headers },
      lookup: (_hostname: string, options: { all?: boolean }, callback: (...args: any[]) => void) => {
        const family = net.isIP(address);
        // Node calls this with `all` either set or not, and expects a different
        // shape for each.
        if (options.all === true) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      const declared = Number(response.headers["content-length"] ?? "0");
      if (Number.isFinite(declared) && declared > MAX_MANIFEST_BYTES) {
        response.destroy();
        fail(badRequest("the registry returned an implausibly large manifest"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > MAX_MANIFEST_BYTES) {
          response.destroy();
          fail(badRequest("the registry returned an implausibly large manifest"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => succeed({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
        header: (name: string) => {
          const value = response.headers[name.toLowerCase()];
          return typeof value === "string" ? value : (Array.isArray(value) ? value[0] ?? null : null);
        },
      }));
      response.on("error", () => fail(badRequest(`the registry connection to ${url.hostname} failed`)));
    });
    request.setTimeout(REGISTRY_IDLE_TIMEOUT_MS, () => {
      request.destroy();
      fail(badRequest(`the registry ${url.hostname} went quiet for ${REGISTRY_IDLE_TIMEOUT_MS}ms`));
    });
    request.on("error", () => fail(badRequest(`the registry connection to ${url.hostname} failed`)));
    request.end();
  });
}

/**
 * Whether an IP is a public internet address.
 *
 * A allowlist-shaped check written as a denylist of the ranges that exist: an
 * unknown-format address falls through to "not public", so a parsing gap fails
 * closed.
 */
export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split(".").map((part) => Number(part));
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
    const [a, b] = octets;
    if (a === 0) return false; // "this network"
    if (a === 10) return false; // RFC1918
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local, incl. the cloud metadata address
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 192 && b === 0) return false; // IETF protocol assignments / test-net
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (version === 6) {
    // Expanded to eight numbers rather than matched as text. An IPv6 address has
    // many spellings of one value — `::ffff:127.0.0.1`, `::ffff:7f00:1` and
    // `0:0:0:0:0:ffff:7f00:1` are the same loopback — so a check written against
    // one spelling passes the others. Comparing numbers removes the spelling
    // from the question entirely.
    const groups = expandIpv6(address.toLowerCase().split("%")[0]);
    if (groups === null) return false; // unparseable: fail closed
    const embeddedIpv4 = () => `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    const zeroThrough = (end: number) => groups.slice(0, end).every((group) => group === 0);

    // ::ffff:0:0/96 — an IPv4 destination wearing a v6 name, in ANY spelling.
    if (zeroThrough(5) && groups[5] === 0xffff) return isPublicAddress(embeddedIpv4());
    if (zeroThrough(6)) {
      // `::` and `::1`.
      if (groups[6] === 0 && groups[7] <= 1) return false;
      // ::/96 IPv4-compatible: deprecated, but still routed to the embedded v4.
      return isPublicAddress(embeddedIpv4());
    }
    // 64:ff9b::/96, the well-known NAT64 prefix, embeds IPv4 the same way.
    if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
      return isPublicAddress(embeddedIpv4());
    }

    // Masked rather than prefix-matched on text: fe80::/10 covers fe80–febf, not
    // just addresses whose text starts "fe80".
    if ((groups[0] & 0xffc0) === 0xfe80) return false; // link-local
    if ((groups[0] & 0xfe00) === 0xfc00) return false; // unique-local
    if ((groups[0] & 0xff00) === 0xff00) return false; // multicast
    return true;
  }
  return false;
}

/**
 * An IPv6 address as its eight 16-bit groups, or null if it cannot be read.
 *
 * Only ever called on a string `net.isIP` already accepted, so this handles the
 * legal forms rather than validating: a `::` run of zeros, and a trailing dotted
 * quad (which is two groups written in decimal).
 */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (dotted !== null) {
    const octets = dotted[2].split(".").map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    text = `${dotted[1]}${(((octets[0] << 8) | octets[1]) >>> 0).toString(16)}:${(((octets[2] << 8) | octets[3]) >>> 0).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const groups = halves.length === 2
    ? [...head, ...new Array<number>(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail]
    : head;
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}
