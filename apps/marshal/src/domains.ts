import { getConfig, resolveNamespaceOrg } from "./config.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { FlyApiError, flyClientForNamespaceOrg } from "./fly/client.js";
import { appNameForService } from "./naming.js";
import { ensurePublicIps, releasePublicIpsIfUnused } from "./public-networking.js";
import { dnsRecordsForCertificate, specIsPublic } from "./services.js";
import { claimDomain, readDomainClaim, readDomainClaimVersioned, readSpec, releaseDomainClaim, rewriteDomainClaim } from "./store.js";
import type { DnsRecord } from "./types.js";

// Fly does NOT enforce hostname uniqueness across apps (smoke-verified), so the bucket
// domain registry is the arbiter: a hostname belongs to exactly one (ns, service) claim,
// established with an atomic conditional PUT. Fly certs remain the source of truth for
// verification state; the registry only answers "who owns this hostname".

// KEPT IN SYNC WITH the backend's HOSTNAME_REGEX (apps/backend/src/lib/deployments/index.tsx),
// duplicated because Marshal is standalone and takes no @hexclave/shared dependency. The
// backend copy must stay at least as strict as this one — see the note there for what a
// divergence costs.
const HOSTNAME_REGEX = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeHostnameOrThrow(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME_REGEX.test(normalized)) throw badRequest(`invalid hostname ${JSON.stringify(hostname)}`);
  return normalized;
}

export type AttachDomainResult = {
  hostname: string,
  service_key: string,
  verified: boolean,
  dns_records: DnsRecord[],
};

export async function attachDomain(ns: string, hostname: string, serviceKey: string): Promise<AttachDomainResult> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const appName = appNameForService(config.envId, ns, serviceKey);
  const stored = await readSpec(ns, serviceKey);
  if (stored === null) {
    throw notFound(`service ${JSON.stringify(serviceKey)} not found in namespace ${JSON.stringify(ns)}`);
  }
  // A domain terminates TLS and routes HTTP, so there must be an HTTP port to
  // route to.
  if (!stored.spec.config.ports.some((entry) => entry.transport === "http")) {
    throw badRequest("custom domains need an HTTP port to route to; this service declares none");
  }

  const existingClaim = await readDomainClaimVersioned(hostname);
  if (existingClaim === null) {
    const claimed = await claimDomain({ hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
    if (!claimed) throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
  } else if (existingClaim.value.ns !== ns) {
    // Never reveal which namespace holds it.
    throw conflict(`hostname ${JSON.stringify(hostname)} is already attached elsewhere`);
  } else if (existingClaim.value.service_key !== serviceKey) {
    // Re-PUT within the namespace repoints: certificate moves from the old service's app.
    const previousApp = appNameForService(config.envId, ns, existingClaim.value.service_key);
    await fly.deleteCertificate(previousApp, hostname);
    await releaseServicePublicIpsIfUnused(ns, existingClaim.value.service_key);
    const rewritten = await rewriteDomainClaim(existingClaim, { hostname, ns, service_key: serviceKey, claimed_at_millis: Date.now() });
    if (!rewritten) throw conflict(`hostname ${JSON.stringify(hostname)} changed owners concurrently; retry the attach`);
  } else {
    // Idempotent re-attach on the same service: re-assert the index entry, which repairs the
    // case where a prior claim landed but its index write was lost (an orphaned claim that
    // deleteService could otherwise never release).
    await claimDomain(existingClaim.value);
  }

  // A custom domain needs the same public ingress as `visibility: "public"`: allocate the
  // shared IPv4 + dedicated IPv6 on first attach. Concurrent attaches of
  // different hostnames on the same app can both observe no IP and both allocate a second
  // dedicated v6 — a minor over-allocation the last-detach release reclaims; a true fix needs
  // per-app allocation serialization, tracked for later.
  await ensurePublicIps(fly, appName);

  let certificate;
  try {
    certificate = await fly.addCertificate(appName, hostname);
  } catch (error) {
    // Same-app re-adds error with "already exists on app" — idempotent re-PUT, read it back.
    if (error instanceof FlyApiError && /already exists/i.test(error.flyMessage)) {
      certificate = await fly.getCertificate(appName, hostname);
      if (certificate === null) throw error;
    } else {
      throw error;
    }
  }

  const refreshedIps = await fly.getAppIps(appName);
  return {
    hostname,
    service_key: serviceKey,
    verified: certificate.clientStatus === "Ready",
    dns_records: dnsRecordsForCertificate(
      appName,
      certificate,
      refreshedIps.sharedIpv4,
      refreshedIps.dedicated.filter((ip) => ip.type === "v6").map((ip) => ip.address),
    ),
  };
}

// Read-only counterpart to attachDomain: reports who owns the hostname and the current
// certificate state WITHOUT touching Fly. `attachDomain` is a repoint — using it as the
// "re-check verification now" primitive means merely reading one service's domain silently
// steals the certificate back from whichever service currently holds the hostname.
export async function readDomain(ns: string, hostname: string): Promise<AttachDomainResult> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const claim = await readDomainClaim(hostname);
  if (claim === null || claim.ns !== ns) {
    throw notFound(`hostname ${JSON.stringify(hostname)} is not attached in namespace ${JSON.stringify(ns)}`);
  }
  const appName = appNameForService(config.envId, ns, claim.service_key);
  const certificate = await fly.getCertificate(appName, hostname);
  if (certificate === null) {
    // Claimed in the registry but no cert on the app: the runtime state was reset (or the
    // app was rebuilt) — same 404 the callers already translate into "deploy first".
    throw notFound(`hostname ${JSON.stringify(hostname)} has no certificate on service ${JSON.stringify(claim.service_key)}`);
  }
  const ips = await fly.getAppIps(appName);
  return {
    hostname,
    service_key: claim.service_key,
    verified: certificate.clientStatus === "Ready",
    dns_records: dnsRecordsForCertificate(
      appName,
      certificate,
      ips.sharedIpv4,
      ips.dedicated.filter((ip) => ip.type === "v6").map((ip) => ip.address),
    ),
  };
}

// `expectedServiceKey` fences a stale detach: when the hostname has since been repointed to
// another service in this namespace, removing it on behalf of the OLD service would tear down
// the new owner's live certificate. Treated as already-detached (404) instead.
export async function detachDomain(ns: string, hostname: string, expectedServiceKey?: string): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const claim = await readDomainClaimVersioned(hostname);
  if (claim === null || claim.value.ns !== ns) {
    throw notFound(`hostname ${JSON.stringify(hostname)} is not attached in namespace ${JSON.stringify(ns)}`);
  }
  if (expectedServiceKey !== undefined && claim.value.service_key !== expectedServiceKey) {
    throw notFound(`hostname ${JSON.stringify(hostname)} is not attached to service ${JSON.stringify(expectedServiceKey)} in namespace ${JSON.stringify(ns)}`);
  }
  const appName = appNameForService(config.envId, ns, claim.value.service_key);
  await fly.deleteCertificate(appName, hostname);
  // Release public IPs BEFORE the claim: a crash between the two must not leave a billable
  // dedicated IP allocated with no claim (and no code path that would ever revisit it). The
  // service stays running and internally reachable; only its public exposure goes away when
  // the last domain detaches.
  await releaseServicePublicIpsIfUnused(ns, claim.value.service_key);
  await releaseDomainClaim(claim);
}

async function releaseServicePublicIpsIfUnused(ns: string, serviceKey: string): Promise<void> {
  const config = getConfig();
  const fly = flyClientForNamespaceOrg(resolveNamespaceOrg(ns));
  const appName = appNameForService(config.envId, ns, serviceKey);
  const spec = await readSpec(ns, serviceKey);
  await releasePublicIpsIfUnused(fly, appName, spec !== null && specIsPublic(spec.spec));
}
