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

// Registries answer manifest requests quickly or not at all; a deployment is
// waiting on this, so it fails fast rather than hanging the request.
const REGISTRY_TIMEOUT_MS = 10_000;
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

/** The image a deployment target will actually run, pinned to a digest. */
export type ResolvedImage = {
  // Fully qualified and digest-pinned: "docker.io/library/postgres@sha256:...".
  // This is what goes into the spec's `source.image`.
  imageRef: string,
  digest: string,
};

/**
 * Resolves a reference to a digest-pinned one, having checked that the image
 * exists, is publicly pullable, and can run on amd64.
 *
 * Both spellings go through the registry: a tag because its digest is unknown,
 * and a digest because everything OTHER than which-bytes is still unknown.
 */
export async function resolveImage(ref: ImageRef): Promise<ResolvedImage> {
  const digest = getConfig().registryKind === "mock"
    // The mock stands in for the whole registry, digests included: an e2e run
    // must not depend on a public registry being reachable.
    ? ref.digest ?? mockDigestFor(ref)
    : await resolveFromRegistry(ref);
  return { imageRef: `${ref.registry}/${ref.repository}@${digest}`, digest };
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
  const reference = ref.digest ?? ref.tag;
  const url = `https://${host}/v2/${ref.repository}/manifests/${reference}`;

  let response = await registryGet(url, {});
  if (response.status === 401) {
    // The standard anonymous-pull handshake: the challenge names where to get a
    // token for this repository, and the token is scoped to it.
    const token = await fetchAnonymousToken(response.header("www-authenticate"), ref);
    if (token !== null) {
      response = await registryGet(url, { Authorization: `Bearer ${token}` });
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
 * Only a manifest LIST can be checked from the manifest alone: a single-platform
 * manifest states its platform in its config blob, which is another request and
 * another failure mode. The list case is the one that actually reaches us —
 * an image published for several architectures but not ours — so it is the one
 * that gets a real error instead of an unstartable machine.
 */
function assertRunnableOnAmd64(body: string, ref: ImageRef): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return; // Not something we can read; the pull is the authority.
  }
  const manifests = (parsed as { manifests?: unknown }).manifests;
  if (!Array.isArray(manifests) || manifests.length === 0) return;
  const platforms = manifests.flatMap((entry) => {
    const platform = (entry as { platform?: { os?: unknown, architecture?: unknown } }).platform;
    if (platform === undefined || typeof platform.os !== "string" || typeof platform.architecture !== "string") return [];
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
async function fetchAnonymousToken(challenge: string | null, ref: ImageRef): Promise<string | null> {
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

  const response = await registryGet(realmUrl.toString(), {});
  if (response.status < 200 || response.status > 299) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return null;
  }
  const record = parsed as { token?: unknown, access_token?: unknown };
  // Registries disagree about which of the two names they use.
  return typeof record.token === "string" ? record.token : (typeof record.access_token === "string" ? record.access_token : null);
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
async function registryGet(url: string, headers: Record<string, string>): Promise<RegistryResponse> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const target = parseHttpsUrl(current);
    const addresses = await resolvePublicAddresses(target.hostname);
    const response = await httpsGetPinned(target, headers, addresses[0]);
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
function httpsGetPinned(url: URL, headers: Record<string, string>, address: string): Promise<RegistryResponse> {
  return new Promise((resolve, reject) => {
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
        reject(badRequest("the registry returned an implausibly large manifest"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > MAX_MANIFEST_BYTES) {
          response.destroy();
          reject(badRequest("the registry returned an implausibly large manifest"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
        header: (name: string) => {
          const value = response.headers[name.toLowerCase()];
          return typeof value === "string" ? value : (Array.isArray(value) ? value[0] ?? null : null);
        },
      }));
      response.on("error", () => reject(badRequest(`the registry connection to ${url.hostname} failed`)));
    });
    request.setTimeout(REGISTRY_TIMEOUT_MS, () => {
      request.destroy();
      reject(badRequest(`the registry ${url.hostname} did not answer within ${REGISTRY_TIMEOUT_MS}ms`));
    });
    request.on("error", () => reject(badRequest(`the registry connection to ${url.hostname} failed`)));
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
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::" || normalized === "::1") return false;
    // IPv4-mapped ("::ffff:10.0.0.1") is an IPv4 destination wearing a v6 name.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped !== null) return isPublicAddress(mapped[1]);
    if (normalized.startsWith("fe80")) return false; // link-local
    if (/^f[cd]/.test(normalized)) return false; // unique-local
    if (normalized.startsWith("ff")) return false; // multicast
    return true;
  }
  return false;
}
